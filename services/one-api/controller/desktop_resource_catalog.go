package controller

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Uploads are serialized within the backend; readers see only an atomic catalog snapshot.
var offlineResourcePublishMu sync.Mutex

type offlineResourceCatalog struct {
	Version int             `json:"version"`
	Bundles []offlineBundle `json:"bundles"`
}

func readOfflineBundles() ([]offlineBundle, error) {
	body, err := os.ReadFile(filepath.Join(desktopResourceRoot(), "catalog.json"))
	if err == nil {
		var catalog offlineResourceCatalog
		if json.Unmarshal(body, &catalog) != nil || catalog.Version != 1 {
			return nil, fmt.Errorf("离线依赖目录索引损坏，请联系管理员")
		}
		for _, bundle := range catalog.Bundles {
			if !resourceID.MatchString(bundle.ID) {
				return nil, fmt.Errorf("离线依赖包标识无效")
			}
		}
		return catalog.Bundles, nil
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("读取离线依赖索引失败")
	}
	// Import the existing published bundle, never previously replaced/unpublished directories.
	if _, err := os.Stat(filepath.Join(desktopResourceRoot(), "current")); os.IsNotExist(err) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	bundle, err := legacyOfflineBundle()
	if err != nil {
		return nil, err
	}
	return []offlineBundle{bundle}, nil
}

func aggregateOfflineBundles(bundles []offlineBundle) (offlineBundle, error) {
	result := offlineBundle{Bundles: bundles, Files: []offlineWheel{}}
	seen := map[string]offlineWheel{}
	for _, bundle := range bundles {
		result.ID, result.CreatedAt = bundle.ID, bundle.CreatedAt
		for _, file := range bundle.Files {
			if !wheelName.MatchString(file.Name) {
				return result, fmt.Errorf("依赖文件名无效")
			}
			key := strings.ToLower(file.Name)
			if previous, ok := seen[key]; ok {
				if previous.SHA256 != file.SHA256 || previous.Size != file.Size {
					return result, fmt.Errorf("依赖文件冲突：%s，同名文件内容不同，未追加资源包", file.Name)
				}
				continue
			}
			file.BundleID = bundle.ID
			seen[key] = file
			result.Files = append(result.Files, file)
		}
	}
	sort.Slice(result.Files, func(i, j int) bool { return result.Files[i].Name < result.Files[j].Name })
	return result, nil
}

func currentOfflineBundle() (offlineBundle, error) {
	bundles, err := readOfflineBundles()
	if err != nil {
		return offlineBundle{}, err
	}
	if len(bundles) == 0 {
		return offlineBundle{}, fmt.Errorf("未上传离线依赖包")
	}
	return aggregateOfflineBundles(bundles)
}

func appendOfflineBundle(bundle offlineBundle) (offlineBundle, error) {
	bundles, err := readOfflineBundles()
	if err != nil {
		return offlineBundle{}, err
	}
	for _, existing := range bundles {
		if existing.ID == bundle.ID {
			return aggregateOfflineBundles(bundles)
		}
	}
	bundles = append(bundles, bundle)
	merged, err := aggregateOfflineBundles(bundles)
	if err != nil {
		return offlineBundle{}, err
	}
	body, err := json.Marshal(offlineResourceCatalog{Version: 1, Bundles: bundles})
	if err != nil {
		return offlineBundle{}, err
	}
	file, err := os.CreateTemp(desktopResourceRoot(), ".catalog-")
	if err != nil {
		return offlineBundle{}, fmt.Errorf("创建依赖目录索引失败")
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(body)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return offlineBundle{}, fmt.Errorf("保存依赖目录索引失败")
	}
	if err := os.Rename(file.Name(), filepath.Join(desktopResourceRoot(), "catalog.json")); err != nil {
		return offlineBundle{}, fmt.Errorf("发布依赖目录索引失败")
	}
	return merged, nil
}

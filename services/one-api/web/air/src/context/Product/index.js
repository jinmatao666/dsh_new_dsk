import React, { useCallback, useMemo, useState } from 'react';
import { Boxes, Hourglass } from 'lucide-react';

// 产品后台注册表：顶部 Tab 用于在不同产品后台之间切换。
// 默认 parvis（当前后台全部内容）；后续新增产品在此追加即可。
// home：该产品的默认落地页（首次进入或无历史记录时跳转的页面）。
export const PRODUCTS = [
  { key: 'parvis', label: 'Parvis', icon: Boxes, home: '/' },
  { key: 'coming-soon', label: '敬请期待', icon: Hourglass, placeholder: true, home: '/coming-soon' }
];

const PRODUCT_STORAGE_KEY = 'active_product';
const LAST_PATH_STORAGE_KEY = 'product_last_path';

// 读取「各产品最后访问路径」映射。
export const readProductPaths = () => {
  try {
    return JSON.parse(localStorage.getItem(LAST_PATH_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
};

// 记录某产品当前访问路径，供下次切回时恢复。
export const writeProductPath = (key, path) => {
  const map = readProductPaths();
  if (map[key] === path) return;
  map[key] = path;
  localStorage.setItem(LAST_PATH_STORAGE_KEY, JSON.stringify(map));
};

// 计算切到某产品时应落地的路径：优先上次访问，其次默认首页。
export const getProductLanding = (key) => {
  const meta = PRODUCTS.find((p) => p.key === key) || PRODUCTS[0];
  return readProductPaths()[key] || meta.home || '/';
};

// 根据路径反推归属产品：parvis 为兜底，其余产品按各自 home 前缀匹配。
export const productForPath = (pathname) => {
  const specific = PRODUCTS.find(
    (p) =>
      p.key !== 'parvis' &&
      p.home &&
      p.home !== '/' &&
      (pathname === p.home || pathname.startsWith(p.home + '/'))
  );
  return specific ? specific.key : 'parvis';
};

export const ProductContext = React.createContext({
  activeProduct: PRODUCTS[0].key,
  activeProductMeta: PRODUCTS[0],
  setActiveProduct: () => null
});

export const ProductProvider = ({ children }) => {
  const [activeProduct, setActiveProductState] = useState(() => {
    const saved = localStorage.getItem(PRODUCT_STORAGE_KEY);
    return PRODUCTS.some((p) => p.key === saved) ? saved : PRODUCTS[0].key;
  });

  const setActiveProduct = useCallback((key) => {
    setActiveProductState((prev) => {
      if (key === prev) return prev;
      localStorage.setItem(PRODUCT_STORAGE_KEY, key);
      return key;
    });
  }, []);

  const activeProductMeta = useMemo(
    () => PRODUCTS.find((p) => p.key === activeProduct) || PRODUCTS[0],
    [activeProduct]
  );

  const value = useMemo(
    () => ({ activeProduct, activeProductMeta, setActiveProduct }),
    [activeProduct, activeProductMeta, setActiveProduct]
  );

  return (
    <ProductContext.Provider value={value}>
      {children}
    </ProductContext.Provider>
  );
};

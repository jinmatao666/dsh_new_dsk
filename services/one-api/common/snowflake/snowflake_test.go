package snowflake

import (
	"sync"
	"testing"
)

func TestNextID_唯一且非零(t *testing.T) {
	if err := Init(0); err != nil {
		t.Fatalf("Init failed: %v", err)
	}
	const n = 10000
	seen := make(map[int64]struct{}, n)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id := NextID()
			if id == 0 {
				t.Errorf("got zero id")
			}
			mu.Lock()
			seen[id] = struct{}{}
			mu.Unlock()
		}()
	}
	wg.Wait()
	if len(seen) != n {
		t.Errorf("expected %d unique ids, got %d (碰撞)", n, len(seen))
	}
}

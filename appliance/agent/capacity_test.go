package main

import "testing"

func TestCapacityMemoryUsesRealGuestTotal(t *testing.T) {
	value, err := capacityMemoryBytes("MemTotal:        8576000 kB\nMemFree: 100 kB\n")
	if err != nil || value != 8576000*1024 {
		t.Fatalf("memory=%d, error=%v", value, err)
	}
	for _, input := range []string{"", "MemFree: 42 kB", "MemTotal: 0 kB", "MemTotal: 5 GB", "MemTotal: 18446744073709551615 kB"} {
		if _, err := capacityMemoryBytes(input); err == nil {
			t.Fatalf("accepted invalid capacity %q", input)
		}
	}
}

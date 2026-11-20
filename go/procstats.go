package main

import (
	"os"
	"runtime"
	"strconv"
	"strings"
)

// procStats: raw CPU counters of the whole machine for `bench/index.ts --procs`, the same shape as
// procStats() in src/cpu-usage.ts: every process as [pid, comm, utime + stime], the kernel's irq +
// softirq and idle from /proc/stat, all in USER_HZ ticks (1/100 s), /proc/uptime, and the CPU package
// temperature in °C (x86_pkg_temp thermal zone, null without one). Linux only.
func procStats() map[string]any {
	if runtime.GOOS != "linux" {
		return map[string]any{}
	}
	entries, _ := os.ReadDir("/proc")
	procs := make([][3]any, 0, len(entries))
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		b, err := os.ReadFile("/proc/" + e.Name() + "/stat")
		if err != nil {
			continue // exited
		}
		s := string(b)
		open, close := strings.IndexByte(s, '('), strings.LastIndexByte(s, ')')
		f := strings.Fields(s[close+2:]) // f[0] is field 3 (state); utime and stime are fields 14, 15
		if open < 0 || len(f) < 13 {
			continue
		}
		ut, _ := strconv.ParseInt(f[11], 10, 64)
		st, _ := strconv.ParseInt(f[12], 10, 64)
		procs = append(procs, [3]any{pid, s[open+1 : close], ut + st})
	}
	var irq, idle int64
	if b, err := os.ReadFile("/proc/stat"); err == nil {
		// cpu  user nice system idle iowait irq softirq steal
		f := strings.Fields(strings.SplitN(string(b), "\n", 2)[0])
		n := func(i int) int64 { v, _ := strconv.ParseInt(f[i], 10, 64); return v }
		if len(f) > 7 {
			idle, irq = n(4)+n(5), n(6)+n(7)
		}
	}
	var up float64
	if b, err := os.ReadFile("/proc/uptime"); err == nil {
		up, _ = strconv.ParseFloat(strings.Fields(string(b))[0], 64)
	}
	return map[string]any{"up": up, "irq": irq, "idle": idle, "temp": cpuTemp(), "procs": procs}
}

func cpuTemp() any {
	zones, _ := os.ReadDir("/sys/class/thermal")
	for _, z := range zones {
		dir := "/sys/class/thermal/" + z.Name()
		if t, err := os.ReadFile(dir + "/type"); err != nil || strings.TrimSpace(string(t)) != "x86_pkg_temp" {
			continue
		}
		if b, err := os.ReadFile(dir + "/temp"); err == nil {
			if v, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64); err == nil {
				return v / 1000
			}
		}
	}
	return nil
}

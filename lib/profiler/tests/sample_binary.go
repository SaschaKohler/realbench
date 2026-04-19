package main

import (
	"fmt"
	"math"
	"time"
)

func computeIntensive() {
	var result float64
	for i := 0; i < 10_000_000; i++ {
		result += float64(i) * math.Pi
	}
	_ = result
}

func memoryIntensive() {
	data := make([]int, 0, 1_000_000)
	for i := 0; i < 1_000_000; i++ {
		data = append(data, i)
	}
	var sum int
	for _, v := range data {
		sum += v
	}
	_ = sum
}

func nestedCall1() {
	computeIntensive()
}

func nestedCall2() {
	nestedCall1()
}

func main() {
	fmt.Println("Starting sample program for profiling...")

	end := time.Now().Add(60 * time.Second)
	for time.Now().Before(end) {
		nestedCall2()
		memoryIntensive()
		time.Sleep(10 * time.Millisecond)
	}

	fmt.Println("Sample program finished.")
}

use std::f64::consts::PI;
use std::thread;
use std::time::{Duration, Instant};

fn compute_intensive() {
    let mut result: f64 = 0.0;
    for i in 0..10_000_000 {
        result += i as f64 * PI;
    }
    let _ = result;
}

fn memory_intensive() {
    let mut data: Vec<i64> = Vec::with_capacity(1_000_000);
    for i in 0..1_000_000 {
        data.push(i);
    }
    let sum: i64 = data.iter().sum();
    let _ = sum;
}

fn nested_call_1() {
    compute_intensive();
}

fn nested_call_2() {
    nested_call_1();
}

fn main() {
    println!("Starting sample program for profiling...");

    let end = Instant::now() + Duration::from_secs(60);
    while Instant::now() < end {
        nested_call_2();
        memory_intensive();
        thread::sleep(Duration::from_millis(10));
    }

    println!("Sample program finished.");
}

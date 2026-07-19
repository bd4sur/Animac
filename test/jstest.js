native(Math);
native(System);
native(String);
System.eval("(display \"灵机解释器 JavaScript解释执行演示\")");
newline();
var count = 0;
var prompt = ["复读机！", "路由器！"];
System.set_interval(1000, ()=> {
    System.eval("(display \"[\")");
    System.eval("(display count)");
    System.eval("(display \"] \")");
    var rnd = Math.random();
    if (rnd > 0.5) {
        rnd = 0;
    }
    else {
        rnd = 1;
    }
    var str = String.concat("人类的本质是", prompt[rnd]);
    display(str);
    newline();
    count++;
});





function fac(n) {
    if (n <= 1) {
        return 1;
    } else {
        return n * fac(n - 1);
    }
}
var result = fac(10);

display("fac(10) = ");
display(result);
newline();





function sqrsum(a, b) {
    return Math.pow(a, 2) + Math.pow(b, 2);
}

var x = Math.sqrt(sqrsum(3, 4));

display("sqrt(3^2 + 4^2) = ");
display(x);
newline();




function power(base, exp, init) {
    if (exp == 0) {
        return init;
    } else {
        if (exp % 2 == 0) {
            return power(base * base, exp / 2, init);
        } else {
            return power(base, exp - 1, base * init);
        }
    }
}
var p = power(2, 10, 1);
display("2^10 = ");
display(p);
newline();


// --- TEST: bubble_sort (based on test/list.scm) ---
function bubble_sort(lst, compare) {
    var n = length(lst);
    var i = 0;
    var j = 0;
    var temp = false;
    var swapped = false;
    while (i < n - 1) {
        swapped = false;
        j = 0;
        while (j < n - i - 1) {
            if (compare(get_item(lst, j), get_item(lst, j + 1))) {
                temp = lst[j];
                lst[j] = lst[j + 1];
                lst[j + 1] = temp;
                swapped = true;
            }
            j = j + 1;
        }
        if (!swapped) { break; }
        i = i + 1;
    }
}

var lst = [1, 1, 4, 5, 1, 4];
bubble_sort(lst, (x, y)=>{ return x > y; })
display(lst);





var is_null = (x) => { return length(x) == 0; };

function filter(f, lst) {
    if (is_null(lst)) {
        return [];
    } else {
        if (f(car(lst))) {
            return cons(car(lst), filter(f, cdr(lst)));
        } else {
            return filter(f, cdr(lst));
        }
    }
}

function concat(a, b) {
    if (is_null(a)) {
        return b;
    } else {
        return cons(car(a), concat(cdr(a), b));
    }
}

function partition(op, pivot, array) {
    return filter((x)=>{ if (op(x, pivot)) { return true; } else { return false; } }, array);
}

function quicksort(array) {
    var pivot = false;
    if (is_null(array) || is_null(cdr(array))) {
        return array;
    } else {
        pivot = car(array);
        return concat(quicksort(partition((x, y)=>{ return x < y; }, pivot, array)),
                      concat(partition((x, y)=>{ return x == y; }, pivot, array),
                             quicksort(partition((x, y)=>{ return x > y; }, pivot, array))));
    }
}

function run() {
    display("快速排序：测试验证列表操作、if、and/or等特殊结构");
    newline();
    display("期望结果：(-3 -3 -2 -1 0 1 2 3 4 5 5 6 6 6 7 8 9)");
    newline();
    display("实际结果：");
    display(quicksort([6, -3, 5, 9, -2, 6, 1, 7, -3, 5, 3, 0, 4, -1, 6, 8, 2]));
    newline();
    newline();
}

run();

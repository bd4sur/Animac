
// (Math.PI) : Number
function PI(PROCESS, RUNTIME) {
    PROCESS.OPSTACK.push(Number(Math.PI));
    PROCESS.Step();
}

// (Math.pow base:Number exponent:Number) : Number
function pow(PROCESS, RUNTIME) {
    let exponent = PROCESS.PopOperand();
    let base = PROCESS.PopOperand();
    let res = Math.pow(Number(base), Number(exponent));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.sqrt x:Number) : Number
function sqrt(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.sqrt(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.exp x:Number) : Number
function exp(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.exp(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log x:Number) : Number
function log(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log10 x:Number) : Number
function log10(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log10(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log2 x:Number) : Number
function log2(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log2(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.sin x:Number) : Number
function sin(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.sin(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.cos x:Number) : Number
function cos(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.cos(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.tan x:Number) : Number
function tan(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.tan(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.atan x:Number) : Number
function atan(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.atan(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.floor x:Number) : Number
function floor(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.floor(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.ceil x:Number) : Number
function ceil(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.ceil(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.round x:Number) : Number
function round(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.round(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.to_fixed x:Number n:Number) : Number
function to_fixed(PROCESS, RUNTIME) {
    let n = PROCESS.PopOperand();
    let x = PROCESS.PopOperand();
    let res = Number(x).toFixed(Number(n));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.abs x:Number) : Number
function abs(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.abs(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.random) : Number
function random(PROCESS, RUNTIME) {
    let res = Math.random();
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

module.exports.PI = PI;
module.exports.pow = pow;
module.exports.sqrt = sqrt;
module.exports.exp = exp;
module.exports.log = log;
module.exports.log10 = log10;
module.exports.log2 = log2;
module.exports.sin = sin;
module.exports.cos = cos;
module.exports.tan = tan;
module.exports.atan = atan;
module.exports.floor = floor;
module.exports.ceil = ceil;
module.exports.round = round;
module.exports.to_fixed = to_fixed;
module.exports.abs = abs;
module.exports.random = random;

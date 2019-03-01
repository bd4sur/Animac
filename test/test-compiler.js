const Compiler = require('../source/compiler.js');

const resource = {
    "variables":["x","k","x","k"],
    "symbols":[],"strings":["\"@\"","\"*\""],
    "slists":[
        {"type":"SLIST","index":0,"children":["$1"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"LAMBDA","index":1,"parentIndex":0,"children":[],"isQuoted":false,"parameters":[],"body":"$2"},
        {"type":"SLIST","index":2,"parentIndex":1,"children":["begin","$3"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"SLIST","index":3,"parentIndex":2,"children":["$4","$10"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"SLIST","index":4,"parentIndex":3,"children":["$5","$8"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"LAMBDA","index":5,"parentIndex":4,"children":[],"isQuoted":false,"parameters":["&0"],"body":"$6"},
        {"type":"SLIST","index":6,"parentIndex":5,"children":["begin","$7","&0"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"SLIST","index":7,"parentIndex":6,"children":["display","*0"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"SLIST","index":8,"parentIndex":4,"children":["call/cc","$9"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"LAMBDA","index":9,"parentIndex":8,"children":[],"isQuoted":false,"parameters":["&1"],"body":"&1"},
        {"type":"SLIST","index":10,"parentIndex":3,"children":["$11","$14"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"LAMBDA","index":11,"parentIndex":10,"children":[],"isQuoted":false,"parameters":["&2"],"body":"$12"},
        {"type":"SLIST","index":12,"parentIndex":11,"children":["begin","$13","&2"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"SLIST","index":13,"parentIndex":12,"children":["display","*1"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"SLIST","index":14,"parentIndex":10,"children":["call/cc","$15"],"isQuoted":false,"parameters":[],"body":null},
        {"type":"LAMBDA","index":15,"parentIndex":14,"children":[],"isQuoted":false,"parameters":["&3"],"body":"&3"}],
    "constants":[],
    "refIndexes":{"*":2,"$":16,"!":0,"&":4,"#":0,"^":0}
};

Compiler.Compiler(resource);

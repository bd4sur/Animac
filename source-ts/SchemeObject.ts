type HandleString = string;

class SchemeObject {
    public type: SchemeObjectType;
    public content: SchemeList | string | number | boolean;
}

enum SchemeObjectType {
    STRING = "STRING",
    SYMBOL = "SYMBOL",
    NUMBER = "NUMBER",
    BOOLEAN = "BOOLEAN",
    LIST = "LIST"
}

class SchemeList {
    public parentHandle: HandleString;
    public children: Array<any>;

    constructor() {
        this.parentHandle = null;
        this.children = new Array<any>();
    }

    public isLambda(): boolean {
        return (this.children[0] === "lambda");
    }

    public getParameters(): Array<any> | void {
        if(this.isLambda()) {
            let arity: number = this.children[1];
            return this.children.slice(2, 2 + arity);
        }
        else {
            return null;
        }
    }
    public getBodies(): Array<any> | void {
        if(this.isLambda()) {
            let arity: number = this.children[1];
            return this.children.slice(2 + arity);
        }
        else {
            return null;
        }
    }
}

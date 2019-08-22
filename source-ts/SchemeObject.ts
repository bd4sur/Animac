
class SchemeObject {
    public type: SchemeObjectType;
    public content: any;// SchemeList | string | number | boolean;
}

enum SchemeObjectType {
    STRING = "STRING",
    SYMBOL = "SYMBOL",
    NUMBER = "NUMBER",
    BOOLEAN = "BOOLEAN",
    LIST = "LIST"
}

class SchemeList {
    public parent: Handle;
    public children: Array<any>;

    constructor() {
        this.parent = null;
        this.children = new Array<any>();
    }

    public isLambda(): boolean {
        return (this.children[0] === "lambda");
    }

    public isNull(): boolean {
        return (this.children.length <= 0);
    }

    public isQuote(): boolean {
        return (this.children[0] === "quote");
    }

    public isQuasiquote(): boolean {
        return (this.children[0] === "quasiquote");
    }

    public isUnquote(): boolean {
        return (this.children[0] === "unquote");
    }
}

// Application List
class ApplicationList extends SchemeList {
    constructor(parent: Handle) {
        super();
        this.parent = parent;
        this.children = new Array<any>();
    }
}

// Quote List
class QuoteList extends SchemeList {
    constructor(parent: Handle) {
        super();
        this.parent = parent;
        this.children = new Array<any>();
        this.children[0] = "quote";
    }
}

// Quasiquote List
class QuasiquoteList extends SchemeList {
    constructor(parent: Handle) {
        super();
        this.parent = parent;
        this.children = new Array<any>();
        this.children[0] = "quasiquote";
    }
}

// Unquote List
class UnquoteList extends SchemeList {
    constructor(parent: Handle) {
        super();
        this.parent = parent;
        this.children = new Array<any>();
        this.children[0] = "unquote";
    }
}

// Lambda List
// [lambda, [param0, ... ], body0, ...]
class LambdaList extends SchemeList {
    constructor(parent: Handle) {
        super();
        this.parent = parent;
        this.children = new Array<any>();
        this.children[0] = "lambda";
        this.children[1] = new Array();
    }
}

//////////////////////////////////////////////////////////////////
//
//  各种具体对象
//
//////////////////////////////////////////////////////////////////

// Application列表对象
class ApplicationObject extends SchemeObject {
    public content: ApplicationList;
    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.LIST;
        this.content = new ApplicationList(parent);
    }
}

// Quote列表对象
class QuoteObject extends SchemeObject {
    public content: QuoteList;
    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.LIST;
        this.content = new QuoteList(parent);
    }
}

// Quasiquote列表对象
class QuasiquoteObject extends SchemeObject {
    public content: QuasiquoteList;
    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.LIST;
        this.content = new QuasiquoteList(parent);
    }
}

// Unquote列表对象
class UnquoteObject extends SchemeObject {
    public content: UnquoteList;
    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.LIST;
        this.content = new UnquoteList(parent);
    }
}

// Lambda列表对象
class LambdaObject extends SchemeObject {
    public content: LambdaList;
    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.LIST;
        this.content = new LambdaList(parent);
    }

    public addParameter(param: string): void {
        this.content.children[1].push(param);
    }

    public addBody(body: any): void {
        this.content.children.push(body);
    }

    public getParameters(): Array<any> {
        return this.content.children[1];
    }

    public getBodies(): Array<any> {
        return this.content.children.slice(2);
    }
}

// 字符串对象
class StringObject extends SchemeObject {
    public content: string;
    constructor(str: string) {
        super();
        this.type = SchemeObjectType.STRING;
        this.content = str;
    }
}

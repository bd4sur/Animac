
// REPL.ts
// Read-Eval-Print Loop

class REPL {
    public allCode: Array<string>;
    public RUNTIME: Runtime;
    public inputBuffer: Array<string>;

    constructor() {
        this.allCode = new Array();
        this.RUNTIME = new Runtime(process.cwd());
        this.inputBuffer = new Array();
    }

    public run(input: string, callback: ()=>any): void {
        try {
            let code = `((lambda () ${this.allCode.join(" ")} (display ${input}) (newline) ))\n`;

            let mod = LoadModuleFromCode(code, PathUtils.Join(this.RUNTIME.workingDir, "repl.scm"));

            let proc = new Process(mod);
            proc.PID = 0;

            this.RUNTIME.asyncCallback = callback;  // NOTE 用于文件读写等异步操作结束之后执行
            this.RUNTIME.processPool[0] = proc;
            this.RUNTIME.AddProcess(proc);
            this.RUNTIME.StartClock(callback);

            // TODO 仅保留有副作用的语句
            if(/define|set!|native|import/gi.test(input)) {
                this.allCode.push(input);
            }
        }
        catch(e) {
            process.stderr.write(`${e.toString()}\n`);
            // 即便报错也要保留define语句
            if(/define/gi.test(input)) {
                this.allCode.push(input);
            }
            callback();
        }
    }

    public CountBrackets(input: string): number {
        let bcount = 0;
        for(let i = 0; i < input.length; i++) {
            if(input[i] === "(" || input[i] === "{") bcount++;
            else if(input[i] === ")" || input[i] === "}") bcount--;
        }
        return bcount;
    }

    public ReadEvalPrint(input: string): void {
        input = input.toString();
        if(input.trim() === ".help") {
            this.RUNTIME.Output(`Animac Scheme Implementation V${ANIMAC_CONFIG.version}\n`);
            this.RUNTIME.Output(`Copyright (c) 2019~2023 BD4SUR\n`);
            this.RUNTIME.Output(`https://github.com/bd4sur/Animac\n`);
            this.RUNTIME.Output(`\n`);
            this.RUNTIME.Output(`REPL Command Reference:\n`);
            this.RUNTIME.Output(`  .exit     exit the REPL.\n`);
            this.RUNTIME.Output(`  .reset    reset the REPL to initial state.\n`);
            this.RUNTIME.Output(`  .help     show usage and copyright information.\n`);
            this.RUNTIME.Output(`\n`);
            this.RUNTIME.Output(`> `);
            return;
        }
        else if(input.trim() === ".exit") {
            process.exit();
        }
        else if(input.trim() === ".reset") {
            this.allCode = new Array();
            this.RUNTIME.Output(`REPL已重置。\n`);
            this.RUNTIME.Output(`> `);
            return;
        }

        this.inputBuffer.push(input);
        let code = this.inputBuffer.join("");
        let indentLevel = this.CountBrackets(code);
        if(indentLevel === 0) {
            this.inputBuffer = new Array();
            this.run(code, ()=> {
                if(this.RUNTIME.processPool[0] !== undefined && this.RUNTIME.processPool[0].state === ProcessState.SLEEPING) {
                    return;
                }
                else {
                    this.RUNTIME.Output("> ");
                }
            });
        }
        else if(indentLevel > 0) {
            let prompt = "...";
            let icount = indentLevel - 1;
            while(icount > 0) {
                prompt += "..";
                icount--;
            }
            this.RUNTIME.Output(`${prompt} `);
        }
        else {
            this.inputBuffer = new Array();
            this.RUNTIME.Error(`[REPL Error] 括号不匹配\n`);
        }
    }

    public Start(): void {
        this.RUNTIME.Output(`Animac Scheme Implementation V${ANIMAC_CONFIG.version}\n`);
        this.RUNTIME.Output(`Copyright (c) 2019~2023 BD4SUR\n`);
        this.RUNTIME.Output(`Type ".help" for more information.\n`);
        this.RUNTIME.Output(`> `);

        process.stdin.on("data", (input)=>{this.ReadEvalPrint(input.toString());});
    }
}

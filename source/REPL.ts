
// REPL.ts
// Read-Eval-Print Loop

function REPL() {
    let allCode = new Array();
    let RUNTIME = new Runtime();

    function run(input: string, callback: ()=>any): void {
        try {
            let code = `((lambda () ${allCode.join(" ")} (display ${input}) (newline) ))\n`;

            let mod = new Module();
            mod.AST = Analyse(Parse(code, "REPL"));
            mod.ILCode = Compile(mod.AST);

            let proc = new Process(mod);
            proc.PID = 0;

            RUNTIME.processPool[0] = proc;
            RUNTIME.AddProcess(proc);
            RUNTIME.StartClock(callback);

            // TODO 仅保留有副作用的语句
            if(/define|set!|native|import/gi.test(input)) {
                allCode.push(input);
            }
        }
        catch(e) {
            process.stderr.write(`${e.toString()}\n`);
            callback();
        }
    }

    function CountBrackets(input: string): number {
        let bcount = 0;
        for(let i = 0; i < input.length; i++) {
            if(input[i] === "(" || input[i] === "{") bcount++;
            else if(input[i] === ")" || input[i] === "}") bcount--;
        }
        return bcount;
    }

    let buffer: Array<string> = new Array();

    function ReadEvalPrint(input: string): void {
        input = input.toString();
        if(input.trim() === ".help") {
            RUNTIME.Output(`AuroraScheme\n`);
            RUNTIME.Output(`Copyright (c) 2019 mikukonai@GitHub, Licenced under MIT.\n`);
            RUNTIME.Output(`https://github.com/mikukonai/AuroraScheme\n`);
            RUNTIME.Output(`\n`);
            RUNTIME.Output(`REPL Command Reference:\n`);
            RUNTIME.Output(`  .exit     exit the REPL.\n`);
            RUNTIME.Output(`  .reset    reset the REPL to initial state.\n`);
            RUNTIME.Output(`  .help     show usage and copyright information.\n`);
            RUNTIME.Output(`\n`);
            RUNTIME.Output(`> `);
            return;
        }
        else if(input.trim() === ".exit") {
            process.exit();
        }
        else if(input.trim() === ".reset") {
            allCode = new Array();
            RUNTIME.Output(`REPL已重置。\n`);
            RUNTIME.Output(`> `);
            return;
        }

        buffer.push(input);
        let code = buffer.join("");
        let indentLevel = CountBrackets(code);
        if(indentLevel === 0) {
            buffer = new Array();
            run(code, ()=> {
                RUNTIME.Output("> ");
            });
        }
        else if(indentLevel > 0) {
            let prompt = "...";
            let icount = indentLevel - 1;
            while(icount > 0) {
                prompt += "..";
                icount--;
            }
            RUNTIME.Output(`${prompt} `);
        }
        else {
            buffer = new Array();
            RUNTIME.Error(`[REPL Error] 括号不匹配\n`);
        }
    }

    RUNTIME.Output(`AuroraScheme REPL\n`);
    RUNTIME.Output(`Type ".help" for more information.\n`);
    RUNTIME.Output(`> `);

    process.stdin.on("data", ReadEvalPrint);

}

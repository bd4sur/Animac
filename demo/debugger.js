function scroll_to_bottom() {
    let scrollHeight = $(".Console").prop("scrollHeight");
    $(".Console").animate({scrollTop:scrollHeight}, 0);
}


function esc(s) {
    return String(s).replace(/&/gi, "&amp;");
}

function renderHeapObjectInfo(hd, info) {
    if(info.type === "CLOSURE") {
        let variableLine = new Array();
        for(let bound in info.boundVariables) {
            let color = "";
            if((info.dirtyFlag)[bound] === true) color = ` style="color: red; font-weight: bold;"`;
            variableLine.push(`<tr class="bound_var"><td class="var_name"${color}>${esc(bound)}</td><td class="var_value"${color}>${esc((info.boundVariables)[bound])}</td></tr>`);
        }
        for(let free in info.freeVariables) {
            variableLine.push(`<tr class="free_var"><td class="var_name">${esc(free)}</td><td class="var_value">${esc((info.freeVariables)[free])}</td></tr>`);
        }

        $("#heap_obj_info").html(`
        <div>${esc(hd)}(${info.instructionAddress})</div>
        <div>Parent: ${esc(info.parent)}</div>
        <table class="closure_var_table">${variableLine.join("")}</table>`);
    }
    else if(info.type === "QUOTE") {
        $("#heap_obj_info").html(`
        <div>${esc(hd)}</div>
        <div>Parent: ${esc(info.parent)}</div>
        <div>${esc(info.children)}</div>`);
    }
    else if(info.type === "CONTINUATION") {
        $("#heap_obj_info").html(`
        <div>${esc(hd)}</div>
        <div>partialEnvironmentJson: ${esc(info.partialEnvironmentJson)}</div>
        <div>contReturnTargetLable: ${esc(info.contReturnTargetLable)}</div>`);
    }
}

function renderDebugInfo(res) {
    let process = res.process;
    let heap_data = process.heap.data;
    let FSTACK = process.FSTACK;
    let OPSTACK = process.OPSTACK;
    let instructions = process.instructions;

    // Console
    $("#output").html($("#output").html() + res.output);

    // 渲染IL代码
    let html = new Array();
    let currentIL_ID = 0;
    for(let i = 0; i < instructions.length; i++) {
        let color = "color:#000000;background-color:#ffffff;";
        if(process.PC === i) color = "color:#ff0000;background-color:#cbeeff;";
        html.push(`<div class="ilcode" id="ilcode${i}" style="${color}"><span class="lineNum">${i}</span>${instructions[i]}</div>`);
    }
    $('#ilcode').html(html.join(""));
    $(".ilcode_column").scrollTop($(".ilcode").height() * (process.PC - 10));

    // 渲染FSTACK
    html = new Array();
    for(let i = FSTACK.length - 1; i >= 0; i--) {
        html.push(`<div class="fstack_line">
        <div class="lineNum">${i}</div>
        <div class="fstack_closure">${esc(FSTACK[i].closureHandle)}</div>
        <div class="fstack_retaddr">${FSTACK[i].returnTargetAddress}</div></div>`);
    }
    $('#fstack').html(html.join(""));

    // 渲染OPSTACK
    html = new Array();
    for(let i = OPSTACK.length - 1; i >= 0; i--) {
        html.push(`<div class="opstack_line"><div class="lineNum">${i}</div><div class="opstack_item">${esc(OPSTACK[i])}</div></div>`);
    }
    $('#opstack').html(html.join(""));

    // 渲染闭包
    html = new Array();
    for(let hd in heap_data) {
        let property = "";
        if((process.heap.metadata[hd])[0] === "S") {
            property = ` heap_obj_static`;
        }
        else if(heap_data[hd].type === "CLOSURE") {
            if(process.currentClosureHandle === hd) {
                property = ` heap_obj_closure heap_obj_closure_current`;
                renderHeapObjectInfo(hd, heap_data[hd]);
            }
            else {
                property = ` heap_obj_closure`;
            }
        }
        else if(process.heap.data[hd].type === "QUOTE") {
            property = ` heap_obj_quote`;
        }
        else if(process.heap.data[hd].type === "CONTINUATION") {
            property = ` heap_obj_continuation`;
        }
        html.push(`<div class="heap_obj_box${property}" data-hd="${esc(hd)}"></div>`);
    }
    $('#heap_map').html(html.join(""));

    $(".heap_obj_box").each((i,e)=>{
        $(e).click((event)=> {
            let hd = $(e).attr("data-hd");
            /* let info = JSON.parse($(e).text()); */
            renderHeapObjectInfo(hd, heap_data[hd]);
        });
    });

    scroll_to_bottom();

}

function clearDebugger() {
    $("#output").html("");
    $('#ilcode').html("");
    $('#fstack').html("");
    $('#opstack').html("");
    $('#heap_map').html("");
    $("#heap_obj_info").html("");
}

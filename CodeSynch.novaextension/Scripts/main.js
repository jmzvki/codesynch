var compositeDisposable = null;

exports.activate = function() {
    compositeDisposable = new CompositeDisposable();

    compositeDisposable.add(
        nova.commands.register("codesynch.write", function(editor) {
            runCommand(editor, "write");
        })
    );

    compositeDisposable.add(
        nova.commands.register("codesynch.explode", function(editor) {
            runCommand(editor, "explode");
        })
    );

    compositeDisposable.add(
        nova.commands.register("codesynch.protocol", function(editor) {
            runCommand(editor, "protocol");
        })
    );

    compositeDisposable.add(
        nova.commands.register("codesynch.explain", function(editor) {
            runCommand(editor, "explain");
        })
    );
    
    compositeDisposable.add(
        nova.commands.register("codesynch.refactor", function(editor) {
            runCommand(editor, "refactor");
        })
    );

    console.log("CodeSynch activated.");
};

exports.deactivate = function() {
    if (compositeDisposable) {
        compositeDisposable.dispose();
        compositeDisposable = null;
    }
};

// ─── Main pipeline ────────────────────────────────────────────────────────────

function runCommand(editor, mode) {
    var claudeKey = nova.config.get("codesynch.claudeApiKey");
    var openaiKey = nova.config.get("codesynch.openaiApiKey");
    var hasClaude = !!(claudeKey && claudeKey.trim());
    var hasOpenAI = !!(openaiKey && openaiKey.trim());

    if (!hasClaude && !hasOpenAI) {
        nova.workspace.showErrorMessage("CodeSynch: No API keys set. Add one in Extensions → CodeSynch Preferences.");
        return;
    }

    var context = resolveContext(editor);
    if (!context) return;

    if (!context.source.trim()) {
        nova.workspace.showErrorMessage("CodeSynch: Nothing to work with — make a selection or open a file.");
        return;
    }

    // Default to Claude, fall back to OpenAI
    var backend = hasClaude ? "claude" : "openai";
    var prompt  = buildPrompt(context, mode);

    nova.workspace.showInformativeMessage("CodeSynch: Thinking...");

    callBackend(prompt, backend)
        .then(function(generated) {
            handleResponse(editor, generated, mode, context);
        })
        .catch(function(err) {
            nova.workspace.showErrorMessage("CodeSynch error: " + err.message);
            console.error("CodeSynch error:", err);
        });
}

// ─── Context / scope resolution ───────────────────────────────────────────────

function resolveContext(editor) {
    var language = editor.document.syntax || "plaintext";
    var sel      = editor.selectedRange;

    // 1. Explicit selection always wins
    if (sel.length > 0) {
        return {
            source:      editor.getTextInRange(sel),
            mode:        "selection",
            language:    language,
            range:       sel,
            instruction: null
        };
    }

    if (language === "python") {
        nova.workspace.showInformativeMessage("CodeSynch: Python scope detection coming soon — please make a selection.");
        return null;
    }

    var fullText = editor.getTextInRange(new Range(0, editor.document.length));
    var cursor   = sel.start;

    // 2. Check if cursor is in a comment block
    var comment = extractCommentAtCursor(fullText, cursor);

    if (comment) {
        var scopeBelow = findScopeBelow(fullText, comment.end, language);
        if (scopeBelow) {
            return {
                source:      fullText.slice(scopeBelow.start, scopeBelow.end),
                mode:        scopeBelow.kind,
                language:    language,
                range:       new Range(scopeBelow.start, scopeBelow.end),
                instruction: comment.text
            };
        }
        return {
            source:      comment.text,
            mode:        "comment",
            language:    language,
            range:       new Range(comment.start, comment.end),
            instruction: null
        };
    }

    // 3. Find enclosing scope at cursor
    var scope = findEnclosingScope(fullText, cursor, language);

    if (scope) {
        return {
            source:      fullText.slice(scope.start, scope.end),
            mode:        scope.kind,
            language:    language,
            range:       new Range(scope.start, scope.end),
            instruction: null
        };
    }

    // 4. Full document fallback
    return {
        source:      fullText,
        mode:        "document",
        language:    language,
        range:       new Range(0, editor.document.length),
        instruction: null
    };
}

// ─── Comment extraction ───────────────────────────────────────────────────────

function extractCommentAtCursor(text, cursor) {
    var lines     = text.split("\n");
    var charCount = 0;
    var cursorLine = 0;

    for (var i = 0; i < lines.length; i++) {
        var lineEnd = charCount + lines[i].length + 1;
        if (cursor < lineEnd) { cursorLine = i; break; }
        charCount = lineEnd;
    }

    var commentPatterns = [
        /^\s*\/\//,
        /^\s*\*/,
        /^\s*\/\*/,
        /^\s*#/
    ];

    var isComment = commentPatterns.some(function(p) {
        return p.test(lines[cursorLine]);
    });

    if (!isComment) return null;

    var blockStart = cursorLine;
    while (blockStart > 0 && commentPatterns.some(function(p) {
        return p.test(lines[blockStart - 1]);
    })) {
        blockStart--;
    }

    var blockEnd = cursorLine;
    while (blockEnd < lines.length - 1 && commentPatterns.some(function(p) {
        return p.test(lines[blockEnd + 1]);
    })) {
        blockEnd++;
    }

    var commentLines = lines.slice(blockStart, blockEnd + 1).map(function(line) {
        return line.trim()
            .replace(/^\/\/\/?\s?/, "")
            .replace(/^#+\s?/, "")
            .replace(/^\/\*+\s?/, "")
            .replace(/\*+\/\s?$/, "")
            .replace(/^\*\s?/, "")
            .trim();
    }).filter(function(line) { return line.length > 0; });

    var startOffset = 0;
    for (var i = 0; i < blockStart; i++) {
        startOffset += lines[i].length + 1;
    }

    var endOffset = startOffset;
    for (var i = blockStart; i <= blockEnd; i++) {
        endOffset += lines[i].length + 1;
    }

    return {
        text:  commentLines.join("\n"),
        start: startOffset,
        end:   endOffset
    };
}

// ─── Find scope below a position ──────────────────────────────────────────────

function findScopeBelow(text, from, language) {
    var patterns  = getScopePatterns(language);
    var kinds     = ["method", "type"];
    var bestStart = -1;
    var bestKind  = null;

    for (var k = 0; k < kinds.length; k++) {
        var kind         = kinds[k];
        var kindPatterns = patterns[kind];
        if (!kindPatterns) continue;

        for (var p = 0; p < kindPatterns.length; p++) {
            var regex = new RegExp(kindPatterns[p], "gm");
            var m;
            while ((m = regex.exec(text)) !== null) {
                if (m.index >= from && (bestStart === -1 || m.index < bestStart)) {
                    bestStart = m.index;
                    bestKind  = kind;
                }
            }
        }
    }

    if (bestStart === -1) return null;

    var scopeEnd = findClosingBrace(text, bestStart);
    if (scopeEnd === -1) return null;

    return { start: bestStart, end: scopeEnd, kind: bestKind };
}

// ─── Enclosing scope ──────────────────────────────────────────────────────────

function findEnclosingScope(text, cursor, language) {
    var patterns = getScopePatterns(language);
    var kinds    = ["method", "type"];

    for (var k = 0; k < kinds.length; k++) {
        var kind         = kinds[k];
        var kindPatterns = patterns[kind];
        if (!kindPatterns) continue;

        var bestStart = -1;

        for (var p = 0; p < kindPatterns.length; p++) {
            var regex = new RegExp(kindPatterns[p], "gm");
            var m;
            while ((m = regex.exec(text)) !== null) {
                if (m.index < cursor && m.index > bestStart) {
                    bestStart = m.index;
                }
            }
        }

        if (bestStart === -1) continue;

        var scopeEnd = findClosingBrace(text, bestStart);
        if (scopeEnd !== -1 && cursor <= scopeEnd) {
            return { start: bestStart, end: scopeEnd, kind: kind };
        }
    }

    return null;
}

// ─── Closing brace walker ─────────────────────────────────────────────────────

function findClosingBrace(text, from) {
    var depth = 0;
    var i     = from;

    while (i < text.length && text[i] !== "{") { i++; }
    if (i >= text.length) return -1;

    var inString = false;
    var strChar  = "";

    for (; i < text.length; i++) {
        var ch   = text[i];
        var prev = i > 0 ? text[i - 1] : "";

        if (inString) {
            if (ch === strChar && prev !== "\\") inString = false;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") { inString = true; strChar = ch; continue; }
        if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i === -1) break; continue; }
        if (ch === "{") depth++;
        if (ch === "}") { depth--; if (depth === 0) return i; }
    }

    return -1;
}

// ─── Scope patterns ───────────────────────────────────────────────────────────

function getScopePatterns(language) {
    var patterns = {
        swift: {
            method: [
                "(?:(?:private|public|internal|fileprivate|open|static|class|override|mutating|async|throws)\\s+)*func\\s+\\w+",
                "(?:convenience\\s+|required\\s+)?init[?!]?\\s*[(<]"
            ],
            type: [
                "(?:final\\s+)?(?:class|struct|enum|actor|protocol)\\s+\\w+",
                "extension\\s+\\w+"
            ]
        },
        javascript: {
            method: [
                "(?:async\\s+)?function\\s*\\*?\\s*\\w+\\s*\\(",
                "(?:static\\s+)?(?:async\\s+)?(?:get\\s+|set\\s+)?\\w+\\s*\\([^)]*\\)\\s*\\{"
            ],
            type: ["class\\s+\\w+"]
        },
        typescript: {
            method: [
                "(?:public|private|protected|static|async|abstract|override)\\s+(?:async\\s+)?\\w+\\s*[(<]",
                "(?:async\\s+)?function\\s*\\*?\\s*\\w+\\s*[(<]"
            ],
            type: [
                "(?:export\\s+)?(?:abstract\\s+)?class\\s+\\w+",
                "(?:export\\s+)?interface\\s+\\w+"
            ]
        },
        php: {
            method: [
                "(?:public|protected|private|static|abstract|final)\\s+(?:static\\s+)?function\\s+\\w+",
                "function\\s+\\w+"
            ],
            type: [
                "(?:abstract\\s+|final\\s+)?class\\s+\\w+",
                "interface\\s+\\w+",
                "trait\\s+\\w+"
            ]
        },
        java: {
            method: [
                "(?:public|private|protected|static|final|abstract|synchronized)\\s+(?:\\w+\\s+)+\\w+\\s*\\("
            ],
            type: [
                "(?:public|private|protected)\\s+(?:abstract\\s+|final\\s+)?(?:class|interface|enum)\\s+\\w+"
            ]
        },
        kotlin: {
            method: [
                "(?:private|public|protected|internal|override|suspend|inline|open|abstract)\\s+fun\\s+\\w+",
                "fun\\s+\\w+"
            ],
            type: [
                "(?:data\\s+|sealed\\s+|abstract\\s+|open\\s+)?(?:class|interface|object|enum class)\\s+\\w+"
            ]
        }
    };

    return patterns[language] || patterns["javascript"];
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(context, mode) {
    var scopeNote = {
        selection: "The developer selected this specific block.",
        method:    "This is the enclosing method/function at the cursor.",
        type:      "This is the enclosing class/type at the cursor.",
        comment:   "This is a comment block describing intent.",
        document:  "This is the full document."
    }[context.mode] || "";

    var languageNote = "You are an expert " + context.language + " engineer. Write clean, idiomatic " + context.language + " code.";

    var density = nova.config.get("codesynch.commentDensity") || "auto";
    var densityNote = {
        auto:   "Add comments based on complexity: for code longer than 5 lines or using non-obvious logic, add clear inline comments explaining WHY. For single dense expressions, add a comment above explaining what it does. Simple self-explanatory code needs no comments.",
        always: "Add thorough comments throughout — explain intent, non-obvious logic, and any complex expressions.",
        never:  "Do not add any comments to the generated code."
    }[density];

    var modeInstructions = {
        write: [
            "Your task: implement the following code based on its signature, comments, and context.",
            "Honor all argument types, return types, and doc comments exactly.",
            "Return ONLY the implementation — no prose, no markdown fences, no explanation.",
            "Write production-quality code. No placeholder TODOs.",
            densityNote
        ].join("\n"),
        explode: [
            "Your task: analyze this code and determine if it should be decomposed.",
            "If the method or class has mixed concerns, does I/O, or has clear polymorphic consumers — extract a protocol and provide a concrete conforming type.",
            "If no abstraction is warranted, implement it directly and say why in a comment.",
            "Begin with: // CODESYNCH: [DIRECT | EXPLODED] — one-line reason",
            "Return ONLY code. No markdown fences. No prose outside of comments.",
            densityNote
        ].join("\n"),
        protocol: [
            "Your task: extract a clean protocol or interface from this concrete type.",
            "Include only the public contract — no implementation details.",
            "Then show the original type conforming to it.",
            "Return ONLY code. No markdown fences. No prose."
        ].join("\n"),
        refactor: [
            "Your task: refactor the following code.",
            "Preserve the exact behavior and public interface — do not change what it does, only how it does it.",
            "Improve: clarity, structure, naming, redundancy, and idiomatic style.",
            "If you spot any bugs, fix them and note them in a comment.",
            "Return ONLY the refactored code — no prose, no markdown fences.",
            densityNote
        ].join("\n"),
        explain: [
            "Your task: explain this code clearly for a developer unfamiliar with this codebase.",
            "Structure your response as:",
            "1. Purpose — one sentence.",
            "2. Contract — inputs, outputs, side effects.",
            "3. Key implementation decisions.",
            "4. Any red flags or suggestions.",
            "Write in plain English. Be direct and concise."
        ].join("\n")
    };

    var intentNote = (context.instruction && context.instruction.trim())
        ? "\n\nIntent from code comments:\n" + context.instruction.trim()
        : "";

    return (
        languageNote + "\n\n" +
        modeInstructions[mode] + "\n\n" +
        "Language: " + context.language + "\n" +
        "Scope: " + scopeNote +
        intentNote + "\n\n" +
        "Code:\n" + context.source
    );
}

// ─── Backend router ───────────────────────────────────────────────────────────

function callBackend(prompt, backend) {
    if (backend === "openai") {
        var apiKey = nova.config.get("codesynch.openaiApiKey");
        var model  = nova.config.get("codesynch.openaiModel") || "gpt-4o";
        return callOpenAI(prompt, apiKey, model);
    }
    var apiKey = nova.config.get("codesynch.claudeApiKey");
    var model  = nova.config.get("codesynch.claudeModel") || "claude-sonnet-4-5";
    return callClaude(prompt, apiKey, model);
}

// ─── Claude API ───────────────────────────────────────────────────────────────

function callClaude(prompt, apiKey, model) {
    var lines   = prompt.split("\n\n");
    var system  = lines[0];
    var content = lines.slice(1).join("\n\n");

    return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json"
        },
        body: JSON.stringify({
            model:      model,
            max_tokens: 4096,
            system:     system,
            messages:   [{ role: "user", content: content }]
        })
    })
    .then(function(response) {
        if (!response.ok) {
            return response.json().then(function(err) {
                throw new Error("Claude API " + response.status + ": " + (err.error && err.error.message ? err.error.message : response.statusText));
            });
        }
        return response.json();
    })
    .then(function(data) {
        var text = "";
        if (data.content && data.content.length > 0) {
            data.content.forEach(function(block) {
                if (block.type === "text") text += block.text;
            });
        }
        if (!text) throw new Error("Claude returned an empty response.");
        return text;
    });
}

// ─── OpenAI API ───────────────────────────────────────────────────────────────

function callOpenAI(prompt, apiKey, model) {
    var lines   = prompt.split("\n\n");
    var system  = lines[0];
    var content = lines.slice(1).join("\n\n");

    return fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + apiKey,
            "content-type":  "application/json"
        },
        body: JSON.stringify({
            model:      model,
            max_tokens: 4096,
            messages: [
                { role: "system", content: system },
                { role: "user",   content: content }
            ]
        })
    })
    .then(function(response) {
        if (!response.ok) {
            return response.json().then(function(err) {
                throw new Error("OpenAI API " + response.status + ": " + (err.error && err.error.message ? err.error.message : response.statusText));
            });
        }
        return response.json();
    })
    .then(function(data) {
        var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!text) throw new Error("OpenAI returned an empty response.");
        return text;
    });
}

// ─── Response handler ─────────────────────────────────────────────────────────

function handleResponse(editor, generated, mode, context) {
    var clean = generated
        .replace(/^```[\w]*\r?\n?/gm, "")
        .replace(/^```\r?$/gm, "")
        .trim();

    // Explain and explode open in new document
    if (mode === "explain" || mode === "explode") {
        nova.workspace.openNewTextDocument({
            content: clean,
            syntax:  editor.document.syntax
        });
        return;
    }

// Insert directly into editor
    editor.edit(function(e) {
        if (context.range && context.mode !== "document") {
            // Strip trailing } when replacing a method scope — the existing brace stays
if (context.mode === "method") {
                clean = clean.replace(/\}\s*$/, "").trimEnd();
                clean = clean + "\n";
            }
            e.replace(context.range, clean);
        } else {
            var sel = editor.selectedRange;
            if (sel.length > 0) {
                e.replace(sel, clean);
            } else {
                e.insert(sel.start, clean);
            }
        }
    });
}
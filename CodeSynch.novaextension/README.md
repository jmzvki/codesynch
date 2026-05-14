# CodeSynch for Nova

A pseudocode-to-code synthesizer for [Nova](https://nova.app) by Panic.

CodeSynch is not a chat assistant. It's a pair programmer. Write your intent 
as comments, place your cursor, fire a command — and CodeSynch fills in the 
implementation. Powered by Claude or ChatGPT.

---

## The Philosophy

Good developers think in comments before they think in code. CodeSynch 
bridges that gap — your pseudocode becomes real code, your intent becomes 
implementation, your architecture sketches become protocols and abstractions.

Write how you think. Let CodeSynch write how the compiler thinks.

---

## Commands

| Command | Shortcut | What it does |
|---|---|---|
| Write / Implement | ⌥⇧W | Implements code from its signature or a comment describing intent |
| Explode / Abstract | ⌥⇧E | Analyzes complexity and decomposes into protocol + concrete type if warranted |
| Refactor | ⌥⇧R | Cleans and improves code while preserving behavior and public interface |
| Generate Protocol | ⌥⇧P | Extracts a clean interface from a concrete type |
| Explain Selection | ⌥⇧X | Produces a plain-English explanation of the selected code |

---

## How It Works

CodeSynch resolves context intelligently — you rarely need to select anything:

**Cursor inside a comment block**
CodeSynch reads the comment as your intent, finds the next code scope below 
it, and uses both to generate the implementation.

```php
// Multiplies two numbers and returns the result
// Handles null by returning 0
function multiply($a, $b) {

}
```
Cursor anywhere in the comment → `⌥⇧W` → implementation appears.

**Cursor inside a method**
CodeSynch finds the enclosing function and operates on that scope.

**Cursor inside a class**
CodeSynch finds the enclosing class and operates on that scope.

**Explicit selection**
Always wins — whatever you select is exactly what gets sent.

---

## Setup

1. Install CodeSynch from the Nova Extension Library
2. Go to **Extensions → CodeSynch → Preferences**
3. Add at least one API key:
   - **Claude**: get one at [console.anthropic.com](https://console.anthropic.com)
   - **ChatGPT**: get one at [platform.openai.com](https://platform.openai.com)
4. Choose your preferred model for each

If only one key is set, CodeSynch uses that backend automatically.

---

## Preferences

| Setting | Description |
|---|---|
| Claude API Key | Your Anthropic API key |
| Claude Model | Opus 4.5 (capable), Sonnet 4.5 (balanced), Haiku 4.5 (fast) |
| OpenAI API Key | Your OpenAI API key |
| OpenAI Model | GPT-4o or GPT-4o mini |
| Comment Density | Auto, Always, or Never — controls how much Claude comments its output |

---

## Comment Density

**Auto** (default) — CodeSynch adds comments based on complexity. Code longer 
than 5 lines or using non-obvious logic gets inline comments explaining WHY. 
Dense single expressions get a comment above. Simple self-explanatory code 
gets none.

**Always** — thorough comments throughout. Good for teaching or onboarding.

**Never** — clean output, no comments. Good for experienced teams with 
established conventions.

---

## Supported Languages

Full scope detection (cursor-based, no selection needed):
- Swift
- PHP
- JavaScript / TypeScript
- Java
- Kotlin

Selection-based (explicit selection required):
- Python *(scope detection coming soon)*
- All other languages

---

## No Dependencies

CodeSynch runs entirely within Nova's built-in JavaScript runtime. No 
Node.js, no npm, no external tools required.

---

## Cost

CodeSynch makes one API call per command. At typical usage:
- Claude Sonnet — fractions of a cent per call
- GPT-4o — fractions of a cent per call

A full day of active use costs pennies.

---

## Philosophy, Expanded

CodeSynch is intentionally scoped. It won't write your whole application. 
It won't maintain a conversation about your architecture. It won't remember 
what you did last session.

What it will do is sit next to you while you work — reading your comments, 
understanding your intent, and filling in the parts that are mechanical. The 
creative decisions stay with you. The typing doesn't have to.

Think of it as Jean Bartik looking over your shoulder. She already knows how 
to write the code. She's just waiting for you to tell her what it should do.

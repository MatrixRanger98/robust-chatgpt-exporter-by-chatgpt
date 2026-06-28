# ChatGPT Conversation Exporter: Usage Guide

## Acknowledgement

This exporter is a substantially modified version of code originally based on the following gist by Olivier Combe:

https://gist.github.com/ocombe/1d7604bd29a91ceb716304ef8b5aa4b5

The current version was significantly revised by ChatGPT with a human in the loop. Major changes include folder-picker based export, one-by-one file writing, top-level folder organization, skip-existing behavior, robust conversation-list fetching, live progress reporting, retry/backoff handling for rate limits, sanitized filenames, URL-encoded links, KaTeX HTML math rendering, and revised attachment handling.

## What This Version Does

This version exports your ChatGPT conversations from the browser console into an organized local folder structure.

It exports:

- JSON conversation backups
- Markdown conversation files
- HTML conversation files with sidebar navigation and KaTeX-rendered ChatGPT-style LaTeX math
- Images and attachments referenced by conversations
- A final run log

It writes files one by one instead of building one final ZIP. This makes long exports safer because progress is saved incrementally.

## Recommended Browser

Use **Chrome desktop** or **Edge desktop**.

This exporter requires the browser File System Access API, especially:

```js
showDirectoryPicker()
```

Firefox and Safari may not support this workflow correctly.

The script now requires folder access. It should not silently fall back to normal browser downloads, because normal browser downloads cannot reliably create nested folders.

## Expected Folder Structure

When you choose an export root folder, the script creates this structure:

```text
export-folder/
  json/
    Conversation_Name_abc12345.json

  markdown/
    Conversation_Name_abc12345.md

  html/
    Conversation_Name_abc12345.html

  files/
    Conversation_Name_abc12345/
      image.png
      attachment.pdf

  chatgpt-export-log.txt
```

The top-level folders are always:

```text
json/
markdown/
html/
files/
```

All Markdown files go into `markdown/`, all HTML files go into `html/`, all JSON files go into `json/`, and attachments go into `files/<conversation-name>/`.

## How to Run

### Step 1: Open ChatGPT

Open ChatGPT in Chrome or Edge desktop:

```text
https://chatgpt.com
```

Make sure you are logged in.

### Step 2: Open the browser console

Chrome or Edge:

- Windows/Linux: `Ctrl + Shift + J`
- macOS: `Cmd + Option + J`

### Step 3: Paste the JavaScript

Open the `.js` exporter file in a text editor.

Copy the entire file.

Paste it into the browser console and press `Enter`.

### Step 4: Click the start button

The script shows an overlay with a button:

```text
Choose Export Folder & Start
```

Click that button.

This click is required because Chrome only allows `showDirectoryPicker()` to open directly from a user gesture.

### Step 5: Choose your export folder

Choose the folder where you want the export to be saved.

The script will create or reuse these subfolders:

```text
json/
markdown/
html/
files/
```

### Step 6: Let it run

Keep the ChatGPT tab open until the export finishes.

The overlay shows live status, including successful conversations, failed conversations, skipped conversations, successful attachments, failed attachments, and files written.

## Robust Conversation List Fetching

The latest version improves how the script fetches your conversation directory from your ChatGPT account.

Older versions stopped too quickly if the API returned an empty page or if the reported `total` count was unstable.

The improved version does the following:

- Fetches conversation pages using `offset` and `limit`.
- Does not stop after a single empty page.
- Retries the same empty page multiple times before deciding the directory is finished.
- Treats `data.total` as a progress hint, not as a hard stopping condition.
- Deduplicates conversations by conversation ID.
- Logs each list-fetch page with details such as:
  - `offset`
  - number of `items` returned
  - number of new conversations added
  - duplicate count
  - unique loaded count
  - reported total

This is meant to avoid missing conversations when the server responds slowly, returns a temporary empty page, or reports an inconsistent total.

## Skip Existing Conversations

The script checks whether a conversation already has all three core export files:

```text
json/<conversation>.json
markdown/<conversation>.md
html/<conversation>.html
```

If all three exist, the conversation is skipped.

Attachments are not used for this skip check, because checking attachments would require fetching the full conversation again.

This lets you safely rerun the exporter later using the same export folder.

## Filename Sanitization

The script sanitizes all local file and folder names.

The current naming rule:

- Replaces unsafe filename characters with `_`.
- Replaces whitespace with `_`.
- Collapses repeated underscores.
- Trims leading and trailing dots, spaces, and underscores.
- Limits filename parts to a safe length.
- Adds the first 8 characters of the conversation ID to reduce collisions.

Example:

```text
Original title:
API test conversation

Saved as:
API_test_conversation_abc12345.md
```

This applies to:

- Markdown filenames
- HTML filenames
- JSON filenames
- attachment folder names
- attachment filenames

## Link Handling in HTML

HTML files contain links to:

- other exported HTML conversations through the sidebar
- images
- attachments

These links are generated using the actual sanitized filenames that are written to disk.

HTML links are also URL encoded using `encodeURI()`, so paths containing Chinese characters or other non-ASCII characters are safer in the browser.

Examples:

```html
<a href="Conversation_Name_abc12345.html">Conversation Name</a>
<img src="../files/Conversation_Name_abc12345/image.png">
<a href="../files/Conversation_Name_abc12345/attachment.pdf">attachment.pdf</a>
```

Because each HTML file lives in `html/`, attachment and image links point to:

```text
../files/<conversation-name>/<attachment-name>
```

## Link Handling in Markdown

Markdown files also use sanitized paths.

Markdown links are additionally URL encoded so special characters do not break Markdown parsing.

This matters for characters such as:

```text
spaces
#
%
(
)
Chinese characters
```

Markdown display text keeps the original human-readable attachment name when possible, while the link target points to the sanitized and encoded local filename.

Example:

```markdown
📎 [original attachment name.pdf](../files/Conversation_Name_abc12345/original_attachment_name.pdf)
```

If a path contains characters that need encoding, the link target is encoded, but the visible link text is not unnecessarily encoded.


## Math Rendering in HTML

The latest HTML exporter supports LaTeX math rendering with **KaTeX**.

Important implementation detail:

```text
The exporter uses KaTeX itself, but it does not use the KaTeX auto-render plugin.
```

Earlier attempts used this order:

```js
el.innerHTML = marked.parse(md);
renderMathInElement(el);
```

That approach can fail because the Markdown parser may consume or transform the backslashes in ChatGPT-style math delimiters before KaTeX sees them. For example, `\(` and `\[` may no longer be intact after Markdown parsing.

The current approach instead protects and renders math **before** passing the remaining text through `marked.parse()`. It calls KaTeX directly, using:

```js
katex.renderToString(tex, {
  displayMode: true_or_false,
  throwOnError: false,
  strict: false,
});
```

The exporter intentionally handles ChatGPT-style delimiters:

```text
\( inline math \)
\[ display math \]
```

It intentionally does **not** try to interpret dollar-sign delimiters:

```text
$inline math$
$$display math$$
```

This avoids false positives with ordinary dollar signs in conversation text, prices, shell prompts, and code snippets.

The generated HTML loads:

- `katex.min.css`
- `katex.min.js`

It does not need `auto-render.min.js` in the current math-rendering design.

If KaTeX fails to load, the page should still show the conversation text rather than going blank. In that case, math may appear as raw LaTeX, but the answers should remain visible.

## JSON Files

JSON files are saved as raw conversation data from ChatGPT:

```js
JSON.stringify(convo, null, 2)
```

The JSON filename is sanitized, but the JSON content itself is not rewritten to point to local attachment paths.

This is intentional. JSON is treated as a raw data backup, not as a local browsing format.

For local browsing, use the HTML or Markdown files.

## Attachment and Image Handling

The script scans each conversation for file references in:

- image asset pointers
- message metadata attachments
- citation metadata with file IDs

For each referenced file, it fetches download metadata, downloads the binary data, and writes it into:

```text
files/<conversation-name>/<attachment-name>
```

Attachment names are sanitized before writing.

If two attachments in the same conversation would have the same sanitized name, the script deduplicates by adding a suffix:

```text
file.pdf
file_1.pdf
file_2.pdf
```

The same final saved filename is used in HTML and Markdown links.

## Rate Limit and Retry Handling

The script retries automatically for:

```text
429 Too Many Requests
500
502
503
504
```

For `429`, it checks the server's `Retry-After` header.

If `Retry-After` is unavailable, it uses exponential backoff with jitter.

Example wait sequence:

```text
2s
4s
8s
16s
...
```

The delay is capped to avoid waiting forever between retries.

## Live Progress Overlay

The script shows a browser overlay with:

- current operation
- progress bar
- current conversation title or file name
- successful conversation count
- failed conversation count
- skipped conversation count
- successful attachment count
- failed attachment count
- number of files written
- detailed log messages

This helps you see whether the script is fetching the account directory, downloading a conversation, writing files, skipping existing files, or waiting because of rate limits.

## Run Log

At the end, the script writes:

```text
chatgpt-export-log.txt
```

The log includes:

- finish time
- conversation success/failure counts
- skipped count
- attachment success/failure counts
- file-write counts
- account directory fetch details
- skipped conversations
- failed conversations
- successful conversations
- attachment failures

This file is useful for debugging incomplete exports.

## What “Successful” Means

A successful file write means the browser accepted the write into the folder you selected through the File System Access API.

This is stronger than a normal browser download trigger because the script directly writes into the selected folder.

## Stopping the Script

To stop the exporter:

1. Refresh the ChatGPT tab, or
2. Close the tab.

Files already written remain on disk.

Rerunning the script on the same folder should skip conversations that already have JSON, Markdown, and HTML files.

## Common Problems

### Error: `showDirectoryPicker` must be handling a user gesture

Use the version with the button.

Correct flow:

```text
Paste script → overlay appears → click Choose Export Folder & Start → choose folder → export starts
```

Incorrect flow:

```text
Paste script → script immediately opens folder picker
```

Chrome blocks the second flow.

### Files appear as `json_filename` or `markdown_filename`

That means the script used normal browser downloads instead of real folder writing.

Use the folder-picker-required version in Chrome or Edge desktop.

### Sidebar links point to missing files

Use the fixed-links version or later.

The corrected versions generate sidebar links from the sanitized filenames actually written to disk.

### Markdown links do not open attachments

Use the Markdown URL-encoded version or later.

The corrected versions sanitize file paths and URL encode Markdown link targets.

### HTML math does not render

Use the KaTeX v4 exporter or later.

The current math-rendering approach uses KaTeX directly with `katex.renderToString()` and handles ChatGPT-style delimiters:

```text
\( inline math \)
\[ display math \]
```

It does not rely on the KaTeX auto-render plugin, and it does not parse `$...$` or `$$...$$`.

For HTML files already exported with an older or broken math renderer, run the existing-HTML KaTeX v4 repair script.

### Some conversations seem missing

Use the robust-list version.

It avoids stopping after a single empty page and logs each conversation-list page so you can inspect whether the account directory fetch finished correctly.

## Recommended Version

Use the latest robust-list version, which includes:

- folder-picker start button
- top-level folder layout
- skip-existing behavior
- sanitized filenames
- fixed HTML sidebar links
- fixed HTML image and attachment links
- URL-encoded Markdown image and attachment links
- 429 retry/backoff
- robust conversation list fetching
- KaTeX math rendering for `\(...\)` and `\[...\]` in HTML
- no dollar-sign math parsing, to avoid false positives
- detailed run log

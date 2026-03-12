import { Editor, MarkdownView, Modal, Notice, Plugin, TFile, App } from 'obsidian';

// Returns the heading level of a line (1-6), or 0 if not a heading
function getHeadingLevel(line: string): number {
	const match = line.match(/^(#{1,6})\s/);
	return match ? match[1].length : 0;
}

// -----------------------------------------------------------------------
// Modal: checkbox picker for which pages to push to
// -----------------------------------------------------------------------
class PagePickerModal extends Modal {
	pages: string[];
	onConfirm: (selected: string[]) => void;

	constructor(app: App, pages: string[], onConfirm: (selected: string[]) => void) {
		super(app);
		this.pages = pages;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: 'Push block to linked pages' });
		contentEl.createEl('p', { 
			text: 'Select which pages to send this block to:',
			cls: 'push-to-page-subtitle'
		});

		// Checkbox for each linked page
		const checkboxes: { page: string; checkbox: HTMLInputElement }[] = [];

		const list = contentEl.createDiv({ cls: 'push-to-page-list' });
		list.style.cssText = 'display:flex; flex-direction:column; gap:8px; margin:12px 0;';

		for (const page of this.pages) {
			const row = list.createDiv();
			row.style.cssText = 'display:flex; align-items:center; gap:10px;';

			const checkbox = row.createEl('input', { type: 'checkbox' });
			checkbox.checked = true;
			checkbox.style.cssText = 'width:16px; height:16px; cursor:pointer;';

			const label = row.createEl('label', { text: `[[${page}]]` });
			label.style.cssText = 'cursor:pointer; font-size:14px;';
			label.onclick = () => { checkbox.checked = !checkbox.checked; };

			checkboxes.push({ page, checkbox });
		}

		// Buttons
		const buttonRow = contentEl.createDiv();
		buttonRow.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:16px;';

		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = buttonRow.createEl('button', { text: 'Push' });
		confirmBtn.style.cssText = 'background-color:var(--interactive-accent); color:var(--text-on-accent); font-weight:600;';
		confirmBtn.onclick = () => {
			const selected = checkboxes
				.filter(c => c.checkbox.checked)
				.map(c => c.page);
			this.close();
			if (selected.length > 0) {
				this.onConfirm(selected);
			} else {
				new Notice('No pages selected — nothing was pushed.');
			}
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}

// -----------------------------------------------------------------------
// Main plugin
// -----------------------------------------------------------------------
export default class PushToPagePlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: 'push-block-to-linked-pages',
			name: 'Push block to linked pages',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				await this.pushBlockToLinkedPages(editor, view);
			}
		});

		this.addCommand({
			id: 'push-all-blocks-to-linked-pages',
			name: 'Push all linked blocks on this page',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				await this.pushAllBlocksToLinkedPages(editor, view);
			}
		});
	}

	// -----------------------------------------------------------------------
	// Push current block — shows picker if 2+ linked pages
	// -----------------------------------------------------------------------
	async pushBlockToLinkedPages(editor: Editor, view: MarkdownView) {
		const cursor = editor.getCursor();
		const block = this.getSemanticBlock(editor, cursor.line);

		if (!block.text.trim()) {
			new Notice('No block found at cursor position.');
			return;
		}

		const linkedPages = this.extractWikiLinks(block.text);

		if (linkedPages.length === 0) {
			new Notice('No linked pages found in this block. Add [[PageName]] links to send content.');
			return;
		}

		const sourceFile = view.file;
		const sourceName = sourceFile ? sourceFile.basename : 'Unknown';

		if (linkedPages.length === 1) {
			// Single page — send immediately
			await this.sendToPages(linkedPages, block.text, sourceName);
		} else {
			// Multiple pages — show picker
			new PagePickerModal(this.app, linkedPages, async (selected) => {
				await this.sendToPages(selected, block.text, sourceName);
			}).open();
		}
	}

	// -----------------------------------------------------------------------
	// Push all linked blocks — shows picker per block if 2+ linked pages
	// -----------------------------------------------------------------------
	async pushAllBlocksToLinkedPages(editor: Editor, view: MarkdownView) {
		const sourceFile = view.file;
		const sourceName = sourceFile ? sourceFile.basename : 'Unknown';
		const totalLines = editor.lineCount();

		const blocks: { text: string; startLine: number; endLine: number }[] = [];
		let i = 0;

		while (i < totalLines) {
			const line = editor.getLine(i).trim();
			if (line === '') { i++; continue; }
			const block = this.getSemanticBlock(editor, i);
			blocks.push(block);
			i = block.endLine + 1;
		}

		const seen = new Set<number>();
		const uniqueBlocks = blocks.filter(b => {
			if (seen.has(b.startLine)) return false;
			seen.add(b.startLine);
			return true;
		});

		const linkedBlocks = uniqueBlocks.filter(b => this.extractWikiLinks(b.text).length > 0);

		if (linkedBlocks.length === 0) {
			new Notice('No blocks with [[linked pages]] found on this page.');
			return;
		}

		// Process blocks sequentially, showing a picker for any with 2+ links
		await this.processBlocksSequentially(linkedBlocks, sourceName, 0);
	}

	async processBlocksSequentially(
		blocks: { text: string; startLine: number; endLine: number }[],
		sourceName: string,
		index: number
	) {
		if (index >= blocks.length) return;

		const block = blocks[index];
		const linkedPages = this.extractWikiLinks(block.text);

		const proceed = async (selected: string[]) => {
			await this.sendToPages(selected, block.text, sourceName);
			await this.processBlocksSequentially(blocks, sourceName, index + 1);
		};

		if (linkedPages.length === 1) {
			await proceed(linkedPages);
		} else {
			// Show a preview of the block in the modal title
			const preview = block.text.split('\n')[0].replace(/^#{1,6}\s/, '').slice(0, 60);
			new PagePickerModal(this.app, linkedPages, proceed).open();
		}
	}

	// -----------------------------------------------------------------------
	// Send a block to a list of pages and report results
	// -----------------------------------------------------------------------
	async sendToPages(pages: string[], blockText: string, sourceName: string) {
		let successCount = 0;
		let failCount = 0;
		const pushed: string[] = [];

		for (const pageName of pages) {
			try {
				await this.appendBlockToPage(pageName, blockText, sourceName);
				successCount++;
				pushed.push(pageName);
			} catch (err) {
				console.error(`PushToPage: Failed to push to "${pageName}":`, err);
				failCount++;
			}
		}

		if (successCount > 0 && failCount === 0) {
			new Notice(`✅ Pushed to: ${pushed.join(', ')}`);
		} else if (successCount > 0 && failCount > 0) {
			new Notice(`⚠️ Pushed to ${successCount} page(s), failed for ${failCount}.`);
		} else {
			new Notice(`❌ Failed to push block.`);
		}
	}

	// -----------------------------------------------------------------------
	// Semantic block detection
	// -----------------------------------------------------------------------
	getSemanticBlock(editor: Editor, startFromLine: number): { text: string; startLine: number; endLine: number } {
		const totalLines = editor.lineCount();
		const cursorLineText = editor.getLine(startFromLine);
		const cursorHeadingLevel = getHeadingLevel(cursorLineText);

		if (cursorHeadingLevel > 0) {
			return this.collectHeadingBlock(editor, startFromLine, cursorHeadingLevel, totalLines);
		}

		for (let i = startFromLine - 1; i >= 0; i--) {
			const level = getHeadingLevel(editor.getLine(i));
			if (level > 0) {
				return this.collectHeadingBlock(editor, i, level, totalLines);
			}
		}

		return this.collectParagraphBlock(editor, startFromLine, totalLines);
	}

	collectHeadingBlock(editor: Editor, headingLine: number, headingLevel: number, totalLines: number): { text: string; startLine: number; endLine: number } {
		let endLine = headingLine;
		for (let i = headingLine + 1; i < totalLines; i++) {
			const level = getHeadingLevel(editor.getLine(i));
			if (level > 0 && level <= headingLevel) break;
			endLine = i;
		}
		while (endLine > headingLine && editor.getLine(endLine).trim() === '') endLine--;
		const lines: string[] = [];
		for (let i = headingLine; i <= endLine; i++) lines.push(editor.getLine(i));
		return { text: lines.join('\n'), startLine: headingLine, endLine };
	}

	collectParagraphBlock(editor: Editor, cursorLine: number, totalLines: number): { text: string; startLine: number; endLine: number } {
		let startLine = cursorLine;
		while (startLine > 0 && editor.getLine(startLine - 1).trim() !== '') startLine--;
		let endLine = cursorLine;
		while (endLine < totalLines - 1 && editor.getLine(endLine + 1).trim() !== '') endLine++;
		const lines: string[] = [];
		for (let i = startLine; i <= endLine; i++) lines.push(editor.getLine(i));
		return { text: lines.join('\n'), startLine, endLine };
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------
	extractWikiLinks(text: string): string[] {
		const regex = /\[\[([^\[\]|#]+)(?:[|#][^\[\]]*)?\]\]/g;
		const links: string[] = [];
		let match;
		while ((match = regex.exec(text)) !== null) {
			const pageName = match[1].trim();
			if (!links.includes(pageName)) links.push(pageName);
		}
		return links;
	}

	async appendBlockToPage(pageName: string, blockText: string, sourceName: string) {
		const { vault } = this.app;
		let file = vault.getAbstractFileByPath(`${pageName}.md`) as TFile | null;
		if (!file) {
			const allFiles = vault.getMarkdownFiles();
			file = allFiles.find(f => f.basename === pageName) || null;
		}
		const timestamp = new Date().toISOString().split('T')[0];
		const appendContent = `\n\n---\n> [!note] Pushed from [[${sourceName}]] on ${timestamp}\n\n${blockText}`;
		if (file) {
			const existing = await vault.read(file);
			await vault.modify(file, existing + appendContent);
		} else {
			await vault.create(`${pageName}.md`, appendContent.trimStart());
		}
	}

	onunload() {}
}

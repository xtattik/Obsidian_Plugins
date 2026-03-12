import { App, Editor, MarkdownView, Notice, Plugin, TFile } from 'obsidian';

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

	async pushAllBlocksToLinkedPages(editor: Editor, view: MarkdownView) {
		const sourceFile = view.file;
		const sourceName = sourceFile ? sourceFile.basename : 'Unknown';
		const totalLines = editor.lineCount();

		// Collect all blocks from the page
		const blocks: { text: string; startLine: number; endLine: number }[] = [];
		let i = 0;

		while (i < totalLines) {
			// Skip blank lines
			if (editor.getLine(i).trim() === '') {
				i++;
				continue;
			}

			// Found start of a block - walk to its end
			let endLine = i;
			while (endLine < totalLines - 1 && editor.getLine(endLine + 1).trim() !== '') {
				endLine++;
			}

			const lines: string[] = [];
			for (let j = i; j <= endLine; j++) {
				lines.push(editor.getLine(j));
			}

			const text = lines.join('\n');
			blocks.push({ text, startLine: i, endLine });
			i = endLine + 1;
		}

		// Filter to only blocks that contain wikilinks
		const linkedBlocks = blocks.filter(b => this.extractWikiLinks(b.text).length > 0);

		if (linkedBlocks.length === 0) {
			new Notice('No blocks with [[linked pages]] found on this page.');
			return;
		}

		let successCount = 0;
		let failCount = 0;
		const pushedPages: string[] = [];

		for (const block of linkedBlocks) {
			const linkedPages = this.extractWikiLinks(block.text);
			for (const pageName of linkedPages) {
				try {
					await this.appendBlockToPage(pageName, block.text, sourceName);
					successCount++;
					pushedPages.push(pageName);
				} catch (err) {
					console.error(`PushToPage: Failed to push to "${pageName}":`, err);
					failCount++;
				}
			}
		}

		if (successCount > 0 && failCount === 0) {
			new Notice(`✅ Pushed ${linkedBlocks.length} block${linkedBlocks.length > 1 ? 's' : ''} to ${successCount} page${successCount > 1 ? 's' : ''}: ${pushedPages.join(', ')}`);
		} else if (successCount > 0 && failCount > 0) {
			new Notice(`⚠️ Pushed to ${successCount} page(s), failed for ${failCount}.`);
		} else {
			new Notice(`❌ Failed to push any blocks.`);
		}
	}

	async pushBlockToLinkedPages(editor: Editor, view: MarkdownView) {
		// Get the current cursor position and extract the block (paragraph)
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		// Find the full paragraph block (handle multi-line blocks separated by blank lines)
		const block = this.getBlockAtCursor(editor, cursor.line);

		if (!block.text.trim() === null || block.text.trim() === '') {
			new Notice('No block found at cursor position.');
			return;
		}

		// Extract all [[wikilinks]] from the block
		const linkedPages = this.extractWikiLinks(block.text);

		if (linkedPages.length === 0) {
			new Notice('No linked pages found in this block. Add [[PageName]] links to send content.');
			return;
		}

		// Get the source file name for attribution
		const sourceFile = view.file;
		const sourceName = sourceFile ? sourceFile.basename : 'Unknown';

		let successCount = 0;
		let failCount = 0;

		for (const pageName of linkedPages) {
			try {
				await this.appendBlockToPage(pageName, block.text, sourceName);
				successCount++;
			} catch (err) {
				console.error(`PushToPage: Failed to push to "${pageName}":`, err);
				failCount++;
			}
		}

		// Show result notice
		if (successCount > 0 && failCount === 0) {
			new Notice(`✅ Block pushed to ${successCount} page${successCount > 1 ? 's' : ''}.`);
		} else if (successCount > 0 && failCount > 0) {
			new Notice(`⚠️ Pushed to ${successCount} page(s), failed for ${failCount}.`);
		} else {
			new Notice(`❌ Failed to push block. Check that linked pages exist or can be created.`);
		}
	}

	getBlockAtCursor(editor: Editor, cursorLine: number): { text: string; startLine: number; endLine: number } {
		const totalLines = editor.lineCount();

		// Walk backwards to find the start of the block (blank line or start of file)
		let startLine = cursorLine;
		while (startLine > 0 && editor.getLine(startLine - 1).trim() !== '') {
			startLine--;
		}

		// Walk forwards to find the end of the block (blank line or end of file)
		let endLine = cursorLine;
		while (endLine < totalLines - 1 && editor.getLine(endLine + 1).trim() !== '') {
			endLine++;
		}

		// Collect block lines
		const lines: string[] = [];
		for (let i = startLine; i <= endLine; i++) {
			lines.push(editor.getLine(i));
		}

		return {
			text: lines.join('\n'),
			startLine,
			endLine,
		};
	}

	extractWikiLinks(text: string): string[] {
		const regex = /\[\[([^\[\]|#]+)(?:[|#][^\[\]]*)?\]\]/g;
		const links: string[] = [];
		let match;

		while ((match = regex.exec(text)) !== null) {
			const pageName = match[1].trim();
			if (!links.includes(pageName)) {
				links.push(pageName);
			}
		}

		return links;
	}

	async appendBlockToPage(pageName: string, blockText: string, sourceName: string) {
		const { vault } = this.app;

		// Try to find the file (Obsidian may store it with .md extension)
		let file = vault.getAbstractFileByPath(`${pageName}.md`) as TFile | null;

		// If not found at root, search all files by basename
		if (!file) {
			const allFiles = vault.getMarkdownFiles();
			file = allFiles.find(f => f.basename === pageName) || null;
		}

		// Format the content to append with source attribution
		const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
		const appendContent = `\n\n---\n> [!note] Pushed from [[${sourceName}]] on ${timestamp}\n\n${blockText}`;

		if (file) {
			// Append to existing file
			const existing = await vault.read(file);
			await vault.modify(file, existing + appendContent);
		} else {
			// Create a new file if it doesn't exist
			await vault.create(`${pageName}.md`, appendContent.trimStart());
		}
	}

	onunload() {}
}

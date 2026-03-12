Obsidian Plugin - push linked wikilinked paragraphs to the page. 
Let's you journal logseq style, but actually embed your thoughts into the relevant pages. 

1. Install the plugin.
  - create .obsidian/plugins/push-to-page 
  - and copy the three files into that folder
  - go into settings in your vault and enable the push-to-page plugin from community plugins
  - suggest adding alt-p as a shortcut for the single block push
2. Type away creating your paragraphs in jouranl pages
While in the relevant paragaph open the command palette search for 'push' and select either the single paragraph or all linked paragprahs on that page.
If multiple pages are linked in a single block you should get an option to choose which pages get the note (all selected by default).

**It should grab everything belonging to your current paragraph (ie, all indents/subeadings/dot points). Should travel up the block hierarchy UNTIL it reaches an identical elvel heading.
So if all your notes are under one larger heading, it may try to grab everything on that page - partly a limitatino of how obsidian understands hierarchy and aprtly a limit of my/claude's ability to code.

Enjoy.

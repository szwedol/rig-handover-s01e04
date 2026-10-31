---
name: preview-pages
description: Save a rig page as one HTML file and publish it, or upload over it, on GitHub Pages from a separate preview repo. Use for a plan's "Preview for review" and "Clean up" steps (ADR 0003).
---

# preview-pages

A preview is one static HTML file on a public HTTPS link we can upload over (ADR 0003). This
skill uses GitHub Pages from a separate repo, `<owner>/rig-preview`, never this repo: previews
don't go in this repo, issues or chat.

Needs `gh`, authenticated, and git able to push over HTTPS (`gh auth setup-git` if it can't).

## Ask first

Every step that publishes is public. Before creating the preview repo, before the first upload,
and before each upload over it, tell the human what goes where, who can see it and how to undo
it (`gh repo delete <owner>/rig-preview`), and wait for a yes.

## 1. Save the page (a command, not "save as")

From this repo, with `.env` in place. Outside the repo, e.g. `../preview/`:

```sh
mkdir -p ../preview
PORT=8799 npx tsx --env-file=.env src/server.ts & PID=$!
until curl -sf localhost:8799/health >/dev/null; do sleep 1; done
curl -sf localhost:8799/digest/<night> -o ../preview/index.html
kill $PID
grep -o 'class="marker">[^<]*' ../preview/index.html
```

Clean-up copy, marker off: start the server with `LANE_MARKER= ` in front. A variable already
set wins over `--env-file`, so the banner reads "no marker set". Check that the marker value
appears 0 times in the file.

## 2. First publish

```sh
mkdir ../rig-preview && cp ../preview/index.html ../rig-preview/ && cd ../rig-preview
git init -b main && git add index.html && git commit -m "Preview: <page>"
gh repo create <owner>/rig-preview --public --source . --push
gh api -X POST repos/<owner>/rig-preview/pages -f 'source[branch]=main' -f 'source[path]=/'
```

The link is `https://<owner>.github.io/rig-preview/`. The first build takes about a minute.

## 3. Upload over it

```sh
cp ../preview/index.html ../rig-preview/index.html
cd ../rig-preview && git commit -am "Preview: <change>" && git push
```

The old version stays in that repo's history. If it must be gone for good, ask the human about
deleting the preview repo.

## 4. Check it as an outsider would

Before you send the link, and after every upload:

```sh
curl -s "https://<owner>.github.io/rig-preview/?v=$(date +%s)" | grep -o 'class="marker">[^<]*'
```

Pages caches for about 10 minutes. Retry until the banner shows what you uploaded.

## Then

- Send the link with the plan's issues. Leave the preview issue open until the reviewer has
  looked.
- After the review: run 1 again with the marker off, then 3 and 4, then close the clean-up issue.

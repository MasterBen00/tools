/* Git recipes for the Git command builder. Placeholders are written {{key}} and filled with shell-quoted values. */

export type Danger = "safe" | "caution" | "destructive";

export interface ParamDef {
    label: string;
    default: string;
    placeholder?: string;
    /** "number" values are validated as positive integers; "ref" as git ref names. */
    kind?: "text" | "number" | "ref";
}

export const PARAMS: Record<string, ParamDef> = {
    branch: { label: "Branch", default: "feature/login", kind: "ref" },
    base: { label: "Base branch", default: "main", kind: "ref" },
    old: { label: "Old branch name", default: "feature/login", kind: "ref" },
    new: { label: "New branch name", default: "feature/sso-login", kind: "ref" },
    n: { label: "Number of commits (N)", default: "3", kind: "number" },
    stash: { label: "Stash index", default: "0", kind: "number" },
    file: { label: "File path", default: "src/main/resources/application.yml" },
    remote: { label: "Remote", default: "origin", kind: "ref" },
    commit: { label: "Commit hash", default: "a1b2c3d" },
    good: { label: "Known good commit or tag", default: "v1.1.0" },
    tag: { label: "Tag", default: "v1.2.0", kind: "ref" },
    message: { label: "Message", default: "Fix login redirect after SSO" },
    url: { label: "Remote URL", default: "git@github.com:acme/shop.git" },
    upstream: { label: "Upstream (original repo) URL", default: "https://github.com/original-owner/shop.git" },
    text: { label: "Text to search for", default: "maxPoolSize" },
    dir: { label: "Worktree folder", default: "../shop-hotfix" },
    path: { label: "Submodule path", default: "libs/common" },
    name: { label: "Your name", default: "Jane Developer" },
    email: { label: "Your email", default: "jane@example.com" },
};

export interface Recipe {
    id: string;
    group: string;
    title: string;
    keywords?: string;
    params: string[];
    /** Command lines; lines starting with # are shown as comments. */
    commands: string[];
    explain: string;
    danger: Danger;
    before: string[];
    undo: string;
}

export const GROUPS = ["Undo", "Branches", "History", "Remote", "Stash", "Tags", "Cleanup", "Config", "Worktrees & submodules"];

export const RECIPES: Recipe[] = [
    // ---------------------------------------------------------------- Undo
    {
        id: "undo-commit-keep", group: "Undo", title: "Undo last commit but keep changes", keywords: "reset soft uncommit",
        params: [], commands: ["git reset --soft HEAD~1"],
        explain: "Moves the branch back one commit. The changes from that commit stay staged, ready to be edited and committed again.",
        danger: "safe",
        before: ["If the commit is already pushed, others may have it; use git revert instead, or you will need a force push.", "Use --mixed instead of --soft to also unstage the changes."],
        undo: "The old commit is still in the reflog: `git reset --soft HEAD@{1}` puts it back.",
    },
    {
        id: "discard-last-commit", group: "Undo", title: "Discard last commit completely", keywords: "reset hard drop throw away",
        params: [], commands: ["git reset --hard HEAD~1"],
        explain: "Moves the branch back one commit and throws away its changes and any uncommitted work in tracked files.",
        danger: "destructive",
        before: ["Run git status first: uncommitted changes in tracked files are lost for good.", "Do not do this on a pushed, shared branch; use git revert."],
        undo: "The commit itself can be recovered for ~90 days: `git reflog`, then `git reset --hard HEAD@{1}`. Uncommitted changes cannot be recovered.",
    },
    {
        id: "unstage-file", group: "Undo", title: "Unstage a file (keep the changes)", keywords: "git add undo restore staged reset",
        params: ["file"], commands: ["git restore --staged {{file}}"],
        explain: "Removes the file from the index (the next commit) without touching your working copy.",
        danger: "safe",
        before: ["On Git older than 2.23 use git reset HEAD -- <file>."],
        undo: "Stage it again with `git add <file>`.",
    },
    {
        id: "discard-file-changes", group: "Undo", title: "Discard local changes to a file", keywords: "restore checkout revert file reset file",
        params: ["file"], commands: ["git restore {{file}}"],
        explain: "Replaces the working copy of the file with the version in the index (or the last commit), throwing away your edits.",
        danger: "destructive",
        before: ["Uncommitted edits to this file are gone forever. git stash push -- <file> first if unsure.", "Add --staged --worktree to also discard staged changes."],
        undo: "Not possible through Git; only your editor's local history may still have the edits.",
    },
    {
        id: "revert-pushed", group: "Undo", title: "Revert a pushed commit", keywords: "undo public commit safe revert",
        params: ["commit", "remote", "branch"], commands: ["git revert {{commit}}", "git push {{remote}} {{branch}}"],
        explain: "Creates a new commit that does the exact opposite of the given commit. History is not rewritten, so it is safe on shared branches.",
        danger: "safe",
        before: ["For a merge commit add -m 1 (keep the first parent's side).", "Resolve conflicts if later commits touched the same lines, then git revert --continue."],
        undo: "Revert the revert: `git revert <hash of the revert commit>`.",
    },
    {
        id: "recover-branch", group: "Undo", title: "Recover a deleted branch", keywords: "reflog restore branch deleted",
        params: ["branch", "commit"], commands: ["# find the last commit of the branch (look for 'checkout: moving from <branch>')", "git reflog --date=relative", "git branch {{branch}} {{commit}}"],
        explain: "Branches are just pointers. The reflog remembers where HEAD has been, so you can find the branch tip and point a new branch at it.",
        danger: "safe",
        before: ["git branch -d prints the tip hash (Deleted branch x (was a1b2c3d)); use it if you still have the terminal output.", "Reflog entries expire after ~90 days and are local to your machine."],
        undo: "Delete the recreated branch with `git branch -d <branch>`.",
    },
    {
        id: "recover-lost-commit", group: "Undo", title: "Recover a lost commit (after reset or rebase)", keywords: "reflog lost dangling fsck",
        params: ["commit"], commands: ["git reflog -n 30", "# or find unreachable commits", "git fsck --lost-found", "git branch rescue {{commit}}"],
        explain: "Commits that no branch points to are kept until garbage collection. Find the hash in the reflog and put a branch on it.",
        danger: "safe",
        before: ["Do not run git gc --prune=now until you have recovered it."],
        undo: "`git branch -D rescue` once you are done.",
    },
    {
        id: "amend-message", group: "Undo", title: "Change the last commit message", keywords: "amend reword typo",
        params: ["message"], commands: ["git commit --amend -m {{message}}"],
        explain: "Replaces the last commit with one that has the new message (and anything currently staged).",
        danger: "caution",
        before: ["This rewrites the commit hash; if it is pushed you will need git push --force-with-lease.", "Make sure nothing is staged that you do not want in that commit."],
        undo: "`git reset --soft HEAD@{1}` and commit again, or reset the branch to the old hash from the reflog.",
    },
    {
        id: "amend-add-file", group: "Undo", title: "Add a forgotten file to the last commit", keywords: "amend no-edit forgot",
        params: ["file"], commands: ["git add {{file}}", "git commit --amend --no-edit"],
        explain: "Stages the file and folds it into the previous commit without changing its message.",
        danger: "caution",
        before: ["Rewrites the last commit; force push (with lease) needed if it was already pushed."],
        undo: "`git reset --soft HEAD@{1}` restores the previous commit with the file staged.",
    },
    {
        id: "abort-merge", group: "Undo", title: "Abort a merge, rebase or cherry-pick in progress", keywords: "conflict abort stop",
        params: [], commands: ["git merge --abort", "# or", "git rebase --abort", "# or", "git cherry-pick --abort"],
        explain: "Stops the operation and returns the branch to where it was before it started.",
        danger: "caution",
        before: ["Any conflict resolutions you made during the operation are lost."],
        undo: "Start the merge/rebase again.",
    },

    // ---------------------------------------------------------------- Branches
    {
        id: "create-branch", group: "Branches", title: "Create a branch and switch to it", keywords: "new checkout -b switch -c",
        params: ["branch", "base"], commands: ["git switch -c {{branch}} {{base}}"],
        explain: "Creates the branch from the base branch and checks it out. Your uncommitted changes come along.",
        danger: "safe",
        before: ["Run git fetch first and use origin/<base> as the start point to branch from the latest remote state."],
        undo: "`git switch -` to go back, then `git branch -d <branch>`.",
    },
    {
        id: "switch-remote-branch", group: "Branches", title: "Check out a branch that exists only on the remote", keywords: "track remote checkout",
        params: ["branch"], commands: ["git fetch", "git switch {{branch}}"],
        explain: "When a remote branch with that name exists, git switch creates a local branch tracking it.",
        danger: "safe",
        before: ["If several remotes have the branch, use git switch -c <branch> --track origin/<branch>."],
        undo: "`git switch -` and `git branch -d <branch>`.",
    },
    {
        id: "rename-branch", group: "Branches", title: "Rename a branch (local and remote)", keywords: "move -m rename",
        params: ["old", "new", "remote"], commands: ["git branch -m {{old}} {{new}}", "git push {{remote}} -u {{new}}", "git push {{remote}} --delete {{old}}"],
        explain: "Renames the local branch, pushes it under the new name with tracking, then removes the old name from the remote.",
        danger: "caution",
        before: ["Open pull requests on the old branch may be closed by the delete; on GitHub prefer renaming in the web UI.", "Teammates need git fetch --prune and git branch -m locally."],
        undo: "Run the same steps with the names swapped.",
    },
    {
        id: "delete-local-branch", group: "Branches", title: "Delete a local branch", keywords: "remove branch -d -D",
        params: ["branch"], commands: ["git branch -d {{branch}}", "# force, even if not merged:", "# git branch -D {{branch}}"],
        explain: "-d only deletes the branch if it is merged into its upstream or HEAD; -D deletes it regardless.",
        danger: "caution",
        before: ["You cannot delete the branch you are on; switch away first."],
        undo: "Git prints the tip hash; `git branch <branch> <hash>` (or find it in git reflog).",
    },
    {
        id: "delete-remote-branch", group: "Branches", title: "Delete a remote branch", keywords: "push delete origin",
        params: ["remote", "branch"], commands: ["git push {{remote}} --delete {{branch}}"],
        explain: "Removes the branch from the remote repository. Your local branch is untouched.",
        danger: "destructive",
        before: ["Make sure it is merged or nobody needs it; open pull requests on it will be closed.", "Branch protection rules may block it."],
        undo: "Push it again from any clone that still has it: `git push <remote> <branch>`.",
    },
    {
        id: "list-merged", group: "Branches", title: "List branches already merged", keywords: "cleanup stale merged",
        params: ["base"], commands: ["git branch --merged {{base}}", "git branch -r --merged {{base}}", "# delete merged local branches except main/master/develop:", "# git branch --merged {{base}} | grep -vE '^\\*|main|master|develop' | xargs -r git branch -d"],
        explain: "Shows branches whose tips are reachable from the base branch, i.e. safe to delete. --no-merged shows the opposite.",
        danger: "safe",
        before: ["Squash-merged and rebase-merged branches do not show up as merged, because their commits differ."],
        undo: "Listing changes nothing.",
    },
    {
        id: "set-upstream", group: "Branches", title: "Push a new branch and set its upstream", keywords: "tracking -u set-upstream-to",
        params: ["remote", "branch"], commands: ["git push -u {{remote}} {{branch}}", "# for an already-pushed branch:", "# git branch --set-upstream-to={{remote}}/{{branch}}"],
        explain: "-u records the remote branch as upstream, so plain git push / git pull / git status work against it.",
        danger: "safe",
        before: ["git config --global push.autoSetupRemote true makes plain git push do this automatically."],
        undo: "`git branch --unset-upstream`.",
    },
    {
        id: "compare-branches", group: "Branches", title: "Compare two branches", keywords: "diff log ahead behind",
        params: ["base", "branch"], commands: ["git log --oneline {{base}}..{{branch}}", "git diff --stat {{base}}...{{branch}}", "git rev-list --left-right --count {{base}}...{{branch}}"],
        explain: "Two dots in log: commits on the branch that are not on base. Three dots in diff: changes since the branches diverged (what a pull request shows). The last command prints behind/ahead counts.",
        danger: "safe",
        before: ["Fetch first and use origin/<base> to compare with the remote state."],
        undo: "Read-only.",
    },

    // ---------------------------------------------------------------- History
    {
        id: "squash-reset", group: "History", title: "Squash the last N commits (reset --soft)", keywords: "combine squash merge commits",
        params: ["n", "message"], commands: ["git reset --soft HEAD~{{n}}", "git commit -m {{message}}"],
        explain: "Moves the branch back N commits but keeps all their changes staged, then records them as one commit. No editor needed.",
        danger: "caution",
        before: ["Count carefully (git log --oneline -n N+1); do not go past a merge commit.", "Rewrites history: force push with lease if already pushed."],
        undo: "`git reset --hard ORIG_HEAD` right after, or reset to the old tip from git reflog.",
    },
    {
        id: "squash-rebase", group: "History", title: "Squash the last N commits (interactive rebase)", keywords: "fixup squash rebase -i",
        params: ["n"], commands: ["git rebase -i HEAD~{{n}}", "# in the editor: keep the first line as pick, change the others to squash (s) or fixup (f)"],
        explain: "Opens an editor listing the commits; squash melds a commit into the one above it and lets you edit the message, fixup discards its message.",
        danger: "caution",
        before: ["Start with a clean working tree (commit or stash).", "Rewrites history: force push with lease if already pushed."],
        undo: "`git rebase --abort` while it runs; afterwards `git reset --hard ORIG_HEAD` or the reflog.",
    },
    {
        id: "rebase-onto-base", group: "History", title: "Rebase a branch on the latest main (interactive)", keywords: "update branch rebase autosquash",
        params: ["remote", "base"], commands: ["git fetch {{remote}}", "git rebase -i --autosquash {{remote}}/{{base}}"],
        explain: "Replays your commits on top of the latest base branch, letting you reorder, edit, squash or drop them. --autosquash places fixup! commits automatically.",
        danger: "caution",
        before: ["Do not rebase a branch others have based work on.", "Resolve conflicts per commit, then git rebase --continue."],
        undo: "`git rebase --abort` during; `git reset --hard ORIG_HEAD` or the reflog after.",
    },
    {
        id: "cherry-pick", group: "History", title: "Copy a commit to the current branch (cherry-pick)", keywords: "backport hotfix pick",
        params: ["commit"], commands: ["git cherry-pick -x {{commit}}"],
        explain: "Applies the changes of that commit as a new commit on your branch. -x appends '(cherry picked from commit …)' to the message for traceability.",
        danger: "safe",
        before: ["Use a range A^..B to pick several commits.", "Conflicts: fix, git add, then git cherry-pick --continue."],
        undo: "`git reset --hard HEAD~1` if not pushed, otherwise git revert.",
    },
    {
        id: "find-line", group: "History", title: "Find which commit introduced a line", keywords: "pickaxe blame log -S who wrote",
        params: ["text", "file"], commands: ["git log -S {{text}} --oneline -- {{file}}", "git log -G {{text}} -p -- {{file}}", "git blame -w -C {{file}}"],
        explain: "-S finds commits where the number of occurrences of the text changed (added or removed); -G matches a regex in the diff. blame shows the last commit to touch each line, ignoring whitespace and following moved code.",
        danger: "safe",
        before: ["Drop the -- <file> part to search the whole repository."],
        undo: "Read-only.",
    },
    {
        id: "bisect", group: "History", title: "Find the commit that broke something (bisect)", keywords: "binary search regression bug",
        params: ["good"], commands: ["git bisect start", "git bisect bad", "git bisect good {{good}}", "# test, then mark each step with: git bisect good | git bisect bad", "# or automate it: git bisect run ./mvnw -q test", "git bisect reset"],
        explain: "Binary-searches history between a good and a bad commit; each step halves the range, so even 1000 commits need only ~10 tests.",
        danger: "safe",
        before: ["Start from a clean working tree.", "git bisect skip for commits that cannot be tested."],
        undo: "`git bisect reset` returns you to where you started.",
    },
    {
        id: "show-file-at-commit", group: "History", title: "Show or restore a file as it was in a commit", keywords: "old version show restore source",
        params: ["commit", "file"], commands: ["git show {{commit}}:{{file}}", "# restore that version into the working tree:", "git restore --source={{commit}} -- {{file}}"],
        explain: "git show prints the file content at that commit; git restore --source writes it to your working copy.",
        danger: "caution",
        before: ["The path is relative to the repository root in git show (use ./path for relative to the current dir).", "restore overwrites your current uncommitted edits to that file."],
        undo: "`git restore <file>` brings back the committed version.",
    },
    {
        id: "log-graph", group: "History", title: "Pretty log graph", keywords: "history tree visualise",
        params: [], commands: ["git log --graph --oneline --decorate --all", "git log --graph --format='%C(auto)%h %d %s %C(dim)(%an, %ar)' -n 30"],
        explain: "Draws the commit graph in the terminal with branch and tag names.",
        danger: "safe",
        before: ["Save it as an alias: git config --global alias.lg \"log --graph --oneline --decorate --all\"."],
        undo: "Read-only.",
    },
    {
        id: "file-history", group: "History", title: "Full history of a file (including renames)", keywords: "follow log file changes",
        params: ["file"], commands: ["git log --follow -p -- {{file}}"],
        explain: "Lists every commit that changed the file with its diff, following it across renames.",
        danger: "safe",
        before: [],
        undo: "Read-only.",
    },

    // ---------------------------------------------------------------- Remote
    {
        id: "change-remote-url", group: "Remote", title: "Change the remote URL", keywords: "set-url ssh https migrate",
        params: ["remote", "url"], commands: ["git remote set-url {{remote}} {{url}}", "git remote -v"],
        explain: "Points the remote at a new URL, e.g. switching from HTTPS to SSH or after moving the repository.",
        danger: "safe",
        before: ["Check you have access to the new URL (git ls-remote <url>)."],
        undo: "Set the old URL again with the same command.",
    },
    {
        id: "fetch-prune", group: "Remote", title: "Fetch and prune deleted remote branches", keywords: "cleanup stale remote tracking",
        params: ["remote"], commands: ["git fetch --prune {{remote}}", "# do it on every fetch:", "git config --global fetch.prune true"],
        explain: "Downloads new commits and removes remote-tracking branches (origin/x) whose branch was deleted on the server.",
        danger: "safe",
        before: ["Only remote-tracking refs are removed, never your local branches."],
        undo: "Nothing to undo; the next fetch recreates refs that still exist.",
    },
    {
        id: "force-push-lease", group: "Remote", title: "Force push safely", keywords: "force-with-lease overwrite rewrite",
        params: ["remote", "branch"], commands: ["git push --force-with-lease --force-if-includes {{remote}} {{branch}}"],
        explain: "Overwrites the remote branch with your rewritten history, but refuses if someone else pushed commits you have not fetched.",
        danger: "destructive",
        before: ["Never force push main or shared branches.", "Tell collaborators: they must reset their local copy (git reset --hard origin/<branch>)."],
        undo: "The old remote tip is in your reflog for origin/<branch>: `git reflog show origin/<branch>`, then push that hash with --force-with-lease.",
    },
    {
        id: "sync-fork", group: "Remote", title: "Sync a fork with the original repository", keywords: "upstream fork update",
        params: ["upstream", "base"], commands: ["git remote add upstream {{upstream}}", "git fetch upstream", "git switch {{base}}", "git merge --ff-only upstream/{{base}}", "git push origin {{base}}"],
        explain: "Adds the original repository as a second remote, fast-forwards your base branch to it and pushes the result to your fork.",
        danger: "safe",
        before: ["Skip the first line if the upstream remote already exists (git remote -v).", "--ff-only fails if you committed directly on the base branch; keep your work on feature branches."],
        undo: "`git reset --hard ORIG_HEAD` before pushing.",
    },
    {
        id: "pull-rebase", group: "Remote", title: "Pull with rebase instead of merge", keywords: "pull --rebase linear history",
        params: ["remote", "branch"], commands: ["git pull --rebase {{remote}} {{branch}}", "# make it the default:", "git config --global pull.rebase true"],
        explain: "Fetches and replays your local commits on top of the remote ones, avoiding 'Merge branch …' commits.",
        danger: "caution",
        before: ["Commit or stash first, or add --autostash."],
        undo: "`git rebase --abort` during; `git reset --hard ORIG_HEAD` after.",
    },

    // ---------------------------------------------------------------- Stash
    {
        id: "stash-untracked", group: "Stash", title: "Stash everything, including untracked files", keywords: "save wip shelve",
        params: ["message"], commands: ["git stash push -u -m {{message}}", "git stash list"],
        explain: "Saves tracked and untracked changes on the stash stack and gives you a clean working tree.",
        danger: "safe",
        before: ["Ignored files are not stashed (use -a for that, carefully)."],
        undo: "`git stash pop` brings the changes back.",
    },
    {
        id: "apply-stash", group: "Stash", title: "Apply a specific stash", keywords: "pop apply stash@",
        params: ["stash"], commands: ["git stash list", "git stash show -p stash@{{{stash}}}", "git stash apply stash@{{{stash}}}", "# remove it once happy:", "# git stash drop stash@{{{stash}}}"],
        explain: "apply restores the stash and keeps it on the stack; pop applies and drops it in one go.",
        danger: "safe",
        before: ["Conflicts can happen if the files changed since; a stash is only dropped by pop when it applies cleanly."],
        undo: "`git restore .` (and git clean for new files) reverts an apply on a clean tree; a dropped stash can be found with git fsck --unreachable | grep commit.",
    },
    {
        id: "stash-file", group: "Stash", title: "Stash a single file", keywords: "partial stash path",
        params: ["message", "file"], commands: ["git stash push -m {{message}} -- {{file}}"],
        explain: "Stashes only the changes to the given path(s), leaving everything else in place.",
        danger: "safe",
        before: ["Use git stash push -p to choose individual hunks interactively."],
        undo: "`git stash pop`.",
    },

    // ---------------------------------------------------------------- Tags
    {
        id: "tag-annotated", group: "Tags", title: "Create an annotated tag", keywords: "release version tag -a",
        params: ["tag", "message", "commit"], commands: ["git tag -a {{tag}} -m {{message}} {{commit}}"],
        explain: "Annotated tags store the tagger, date and message (and can be signed with -s); they are what git describe and release tooling expect.",
        danger: "safe",
        before: ["Drop the commit hash to tag the current HEAD."],
        undo: "`git tag -d <tag>` (before pushing).",
    },
    {
        id: "push-tags", group: "Tags", title: "Push tags", keywords: "push tag release",
        params: ["remote", "tag"], commands: ["git push {{remote}} {{tag}}", "# push all annotated tags reachable from pushed commits:", "git push --follow-tags"],
        explain: "Tags are not pushed by a normal git push; push one explicitly or use --follow-tags.",
        danger: "safe",
        before: ["Avoid git push --tags: it also pushes stale local lightweight tags."],
        undo: "Delete the remote tag (see Delete a remote tag).",
    },
    {
        id: "delete-remote-tag", group: "Tags", title: "Delete a tag locally and on the remote", keywords: "remove tag retag",
        params: ["tag", "remote"], commands: ["git tag -d {{tag}}", "git push {{remote}} --delete {{tag}}"],
        explain: "Removes the tag from your clone and from the remote.",
        danger: "destructive",
        before: ["Published release tags may already be used by CI, package registries or other clones; prefer a new version over moving a tag."],
        undo: "Recreate it on the same commit (`git tag -a <tag> <hash>`) and push it again.",
    },

    // ---------------------------------------------------------------- Cleanup
    {
        id: "clean-untracked", group: "Cleanup", title: "Remove untracked files (dry run first)", keywords: "clean -fd purge",
        params: [], commands: ["git clean -n -d", "# after checking the list:", "git clean -f -d"],
        explain: "-n lists what would be deleted; -f -d deletes untracked files and directories. Ignored files are kept unless you add -x.",
        danger: "destructive",
        before: ["Always run the dry run first; deleted files do not go to the recycle bin.", "git clean -i gives an interactive menu."],
        undo: "Not possible with Git; untracked files were never stored.",
    },
    {
        id: "untrack-keep", group: "Cleanup", title: "Stop tracking a file but keep it locally", keywords: "rm --cached gitignore committed by mistake",
        params: ["file"], commands: ["git rm --cached {{file}}", "echo {{file}} >> .gitignore", "git add .gitignore", "git commit -m 'Stop tracking file'"],
        explain: "Removes the file from the repository (from the next commit on) while leaving it on disk, and ignores it from now on.",
        danger: "caution",
        before: ["Add -r for a directory.", "The file still exists in history; if it contained secrets, rotate them (and consider git filter-repo).", "Other clones will delete the file on their next pull."],
        undo: "`git add -f <file>` and remove the .gitignore line.",
    },
    {
        id: "gc", group: "Cleanup", title: "Compact the repository (gc)", keywords: "garbage collect size prune",
        params: [], commands: ["git count-objects -vH", "git gc", "# aggressive and drop unreachable objects now (no reflog recovery afterwards):", "# git reflog expire --expire=now --all && git gc --prune=now --aggressive"],
        explain: "Packs loose objects and removes unreachable ones older than two weeks. Git runs it automatically now and then.",
        danger: "caution",
        before: ["The commented line makes lost commits unrecoverable; only use it after a history rewrite you are sure about."],
        undo: "Plain gc is harmless; pruned objects cannot be recovered.",
    },

    // ---------------------------------------------------------------- Config
    {
        id: "set-identity", group: "Config", title: "Set name and email for this repository", keywords: "user.name user.email work personal",
        params: ["name", "email"], commands: ["git config user.name {{name}}", "git config user.email {{email}}", "git config --list --show-origin | grep user."],
        explain: "Without --global the setting is stored in .git/config and applies only to this repository, which is handy for separating work and personal identities.",
        danger: "safe",
        before: ["Already-made commits keep the old author; fix the last one with git commit --amend --reset-author --no-edit."],
        undo: "`git config --unset user.email` to fall back to the global value.",
    },
    {
        id: "aliases", group: "Config", title: "Useful aliases", keywords: "alias shortcut config",
        params: [], commands: [
            "git config --global alias.st 'status -sb'",
            "git config --global alias.co switch",
            "git config --global alias.lg 'log --graph --oneline --decorate --all'",
            "git config --global alias.undo 'reset --soft HEAD~1'",
            "git config --global alias.amend 'commit --amend --no-edit'",
            "git config --global alias.pushf 'push --force-with-lease'",
        ],
        explain: "Short names for long commands: git st, git lg, git undo …",
        danger: "safe",
        before: ["Aliases cannot override built-in command names."],
        undo: "`git config --global --unset alias.<name>`.",
    },
    {
        id: "line-endings", group: "Config", title: "Fix line endings (CRLF / LF)", keywords: "autocrlf gitattributes windows eol",
        params: [], commands: ["# Windows:", "git config --global core.autocrlf true", "# macOS / Linux:", "git config --global core.autocrlf input", "# best: decide per repository in .gitattributes", "echo '* text=auto eol=lf' >> .gitattributes", "echo '*.{cmd,bat} text eol=crlf' >> .gitattributes", "git add --renormalize .", "git commit -m 'Normalize line endings'"],
        explain: ".gitattributes travels with the repository, so everyone gets the same line endings regardless of their personal settings. --renormalize rewrites already-committed files.",
        danger: "safe",
        before: ["Commit or stash your work first: renormalize can touch many files.", "Keep mvnw and *.sh as LF or they break in Linux containers."],
        undo: "Revert the normalisation commit.",
    },

    // ---------------------------------------------------------------- Worktrees & submodules
    {
        id: "worktree-add", group: "Worktrees & submodules", title: "Work on another branch in a second folder (worktree)", keywords: "worktree hotfix parallel",
        params: ["dir", "branch"], commands: ["git worktree add {{dir}} {{branch}}", "git worktree list", "# when done:", "git worktree remove {{dir}}"],
        explain: "Checks out a second branch in its own folder that shares the same repository, so you can fix a hotfix without stashing your current work.",
        danger: "safe",
        before: ["A branch can be checked out in only one worktree at a time; use -b <new-branch> to create one."],
        undo: "`git worktree remove <dir>` (add --force if it has changes).",
    },
    {
        id: "submodule-update", group: "Worktrees & submodules", title: "Clone or update submodules", keywords: "submodule init recursive",
        params: ["url"], commands: ["git clone --recurse-submodules {{url}}", "# in an existing clone:", "git submodule update --init --recursive"],
        explain: "Submodules are pinned to a commit; this checks out exactly those commits.",
        danger: "safe",
        before: ["git config --global submodule.recurse true makes pull and switch update submodules too."],
        undo: "`git submodule deinit -f <path>` empties a submodule folder.",
    },
    {
        id: "submodule-add", group: "Worktrees & submodules", title: "Add a submodule", keywords: "submodule add vendor",
        params: ["url", "path"], commands: ["git submodule add {{url}} {{path}}", "git commit -m 'Add submodule'"],
        explain: "Registers another repository at the given path (in .gitmodules) pinned to its current commit.",
        danger: "safe",
        before: ["Everyone cloning needs --recurse-submodules; consider a package manager dependency instead."],
        undo: "`git rm <path>` then remove the leftover .git/modules/<path> folder.",
    },
];

/** Quote a value for POSIX shells only when needed. */
export function shellQuote(v: string): string {
    if (v === "") return "''";
    if (/^[A-Za-z0-9_\-./:@%+=,~^]+$/.test(v)) return v;
    return "'" + v.replace(/'/g, "'\\''") + "'";
}

/** Rough check of git ref name rules. Returns an error message or "". */
export function refProblem(v: string): string {
    if (!v) return "Required.";
    if (/\s/.test(v)) return "Spaces are not allowed in ref names.";
    if (/\.\.|[~^:?*[\\]|@\{|^[-/.]|[/.]$|\.lock$|\/\//.test(v)) return "Not a valid ref name (no .., ~ ^ : ? * [ \\, @{, leading - or trailing / or .).";
    return "";
}

export function fill(cmd: string, values: Record<string, string>): string {
    return cmd.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
        const def = PARAMS[k];
        let v = values[k] ?? def?.default ?? "";
        if (def?.kind === "number") v = /^\d+$/.test(v.trim()) ? String(Number(v)) : def.default;
        return def?.kind === "number" ? v : shellQuote(v);
    });
}

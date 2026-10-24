// Glossary v3 text for GitHub: the v2 vocabulary plus the v3 extras.
// Two variants differ only in where conventions live.
import { GITHUB_GLOSSARY_V2 } from "../github/glossary.ts";

const EXTRAS = `v3 extras:
  Every result is numbered @1, @2, ... Reuse pieces instead of retyping them:
    content=@3 (the exact bytes of a file you read)   labels=@4[*].name   octo/app#@5[*].number (one command per row)
  key<<EOF on the end of a line starts a literal block; every byte up to a line with only EOF is kept, plus a final newline
  (key<<EOF! leaves the final newline out):
    write file octo/app path=docs/a.md message="add a" branch=main content<<EOF
    first line
    EOF
  all: fetch every page in one go.
  Pipeline: | where <field> <op> <value> | select a,b | sort <field> [desc] | top <n> | group <field> | count
            | sum <field> | avg <field> | min <field> | max <field> | distinct <field>
    ops: = != > >= < <= has contains starts empty notempty, and in / notin another result: where user in @2[*].assignees
    e.g. list issue octo/app state=open all | where labels has bug | count
  A pipeline can start from an earlier result: @3 | where comments > 2 | count
  calc does arithmetic over numbers and results: calc @4 / @5 * 100
  labels+=x  labels-=x  assignees+=x  assignees-=x: change an issue's lists without retyping them.
  close issue T [reason=not_planned]   reopen issue T   comment T body=...
  form <command> <target>: the command's keys, allowed values and the repo's real labels, assignees and branches.
  Lists come back as tables: name[count]{fields}: one row per record; list cells are joined with |.`;

const LEGEND = `Conventions (applied silently, no warning in the answers):
  [paged] list and search return 30 items per page (perPage up to 100); add all to get every page.
  list issue and list pr: open items only unless state= is given; newest first unless direction=asc.
  search: open and closed items unless the query says is:open or is:closed.
  [irreversible] merge pr, delete file, and bulk close cannot be undone: do them only when asked.`;

const FEEDBACK = "Each answer ends with what was applied and ready-to-send next commands; errors include corrected commands.";

export const GITHUB_GLOSSARY_V3_LEGEND = `${GITHUB_GLOSSARY_V2}\n\n${EXTRAS}\n\n${LEGEND}`;
export const GITHUB_GLOSSARY_V3_FEEDBACK = `${GITHUB_GLOSSARY_V2}\n\n${EXTRAS}\n\n${FEEDBACK}`;

// v4: the feedback variant, plus how compact lists, single-object pipes and batched gets work.
const V4_EXTRAS = `v4:
  Lists show a few columns (issues: number,title,state,labels,assignees,comments; PRs: number,title,state,merged,user,head,base);
  a "more fields:" line names the rest, and | select number,body (or any field) brings them back. "all rows:" lists values shared by every row.
  | select and | where also work on a single result: get issue octo/app#4 | select title,user
  Several numbers in one command: get issue octo/app#1,5,9 (one table back).
  A list filter the tool lacks (assignees=ana) is applied for you as | where over every page.`;

export const GITHUB_GLOSSARY_V4 = `${GITHUB_GLOSSARY_V3_FEEDBACK}\n\n${V4_EXTRAS}`;

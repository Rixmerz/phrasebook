// Glossary for the 46 tools of the GitHub MCP server's default toolsets.
// It must express everything those tools can do, so the token comparison is fair.

export const GITHUB_GLOSSARY = `GitHub. Send one command per line: <verb> <noun> [target] [key=value ...]

Targets:
  <owner>/<repo>                      a repository
  <owner>/<repo>#<n>                  an issue or pull request number
  Values with spaces go in quotes: title="Fix login bug"
  Lists are comma separated: labels=bug,ui  reviewers=ana,bruno
  Paging on any list or search: page=<n> per_page=<n> (max 100)

Nouns and what you can do with them:
  me                       get
  repo                     create name= [organization=] [private=true] [description=] [auto_init=true]
                           | fork [organization=] | search query= [sort=stars|forks|updated]
  branch                   list | create branch= [from=]
  commit                   get sha= [detail=none|stats|full_patch] | list [sha=] [path=] [author=] [since=] [until=]
                           | search query= [sort=author-date|committer-date]
  file                     get path= [ref=] | write path= content= message= branch= [sha=]
                           | delete path= message= branch= | push branch= message= files=[{path,content}]
  code                     search query=
  tag                      list | get tag=
  release                  list | latest | get tag=
  issue                    get | list [state=open|closed] [labels=] [order_by=created_at|updated_at|comments] [since=]
                           | create title= [body=] [labels=] [assignees=] [milestone=] [type=]
                           | update [title=] [body=] [state=open|closed] [state_reason=completed|not_planned|duplicate]
                             [duplicate_of=] [labels=] [assignees=] [milestone=] [type=]
                           | search query= [sort=comments|reactions|created|updated]
                           | assign-copilot [base_ref=] [instructions=]
  issue comment            list | add body= | update comment_id= body= | react comment_id= reaction=+1|-1|laugh|confused|heart|hooray|rocket|eyes
  sub-issue                list | parent | add sub_issue_id= | remove sub_issue_id= | reprioritize sub_issue_id= [after_id=|before_id=]
  label                    get name= | list (of an issue)
  pr                       get | list [state=open|closed|all] [base=] [head=] [sort=created|updated|popularity] [direction=asc|desc]
                           | create title= head= base= [body=] [draft=true] [reviewers=]
                           | update [title=] [body=] [state=open|closed] [base=] [draft=] [reviewers=]
                           | merge [method=merge|squash|rebase] [title=] [message=]
                           | update-branch | diff | status | files | commits | checks
                           | search query= [sort=comments|reactions|created|updated]
                           | request-copilot-review
  pr comment               list | reply comment_id= body= | react comment_id= reaction=
  review                   list | create [event=APPROVE|REQUEST_CHANGES|COMMENT] [body=]
                           | submit [event=] [body=] | discard
                           | comment path= body= subject=line|file [line=] [side=LEFT|RIGHT] [start_line=]
                           | resolve thread= | unresolve thread=
  review comment           list
  user                     search query= [sort=followers|repositories|joined]
  team                     list [user=] | members org= team=
  collaborator             list [affiliation=outside|direct|all]
  issue field, issue type  list (owner or <owner>/<repo>)
  options                  list kind=labels|assignees|milestones|issue_types|branches|issue_fields|reviewers

Examples:
  list issue octo/app state=open labels=bug
  create pr octo/app title="Add login" head=feat/login base=main
  merge pr octo/app#42 method=squash
  add issue comment octo/app#7 body="Fixed in #42"`;

export const githubGlossaryTool = {
  name: "github",
  description: GITHUB_GLOSSARY,
  input_schema: {
    type: "object" as const,
    properties: { command: { type: "string", description: "One or more commands, one per line." } },
    required: ["command"],
  },
};

// v2: same vocabulary, with the two rules the v2 parser adds made explicit.
export const GITHUB_GLOSSARY_V2 = GITHUB_GLOSSARY
  .replace(
    "GitHub. Send one command per line: <verb> <noun> [target] [key=value ...]",
    "GitHub. Send one command per line: <verb> <noun> [target] [key=value ...]\nWord order is free and plurals are fine: \"files pr octo/app#10\" = \"pr files octo/app#10\".",
  )
  .replace("  pr comment               list | reply comment_id= body=", "  pr comment               list | add body= | reply comment_id= body=");

export const githubGlossaryToolV2 = { ...githubGlossaryTool, description: GITHUB_GLOSSARY_V2 };

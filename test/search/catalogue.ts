// Fake catalogue of ~60 tools across seven accounts, modelled on real MCP servers.
import { qualify, type ToolRef } from "../../src/core/types.ts";

type Spec = [name: string, description: string, params: string[]];

const SPECS: Record<string, Spec[]> = {
  gmail: [
    ["send_email", "Send an email message to one or more recipients", ["to", "cc", "subject", "body"]],
    ["search_emails", "Search the mailbox for messages matching a Gmail query", ["query", "maxResults"]],
    ["read_email", "Read the full content of an email message by id", ["messageId"]],
    ["create_draft", "Create a draft email without sending it", ["to", "subject", "body"]],
    ["list_labels", "List all labels in the mailbox", []],
    ["modify_labels", "Add or remove labels on an email message", ["messageId", "addLabels", "removeLabels"]],
    ["delete_email", "Move an email message to the trash", ["messageId"]],
    ["reply_email", "Reply to an existing email thread", ["threadId", "body"]],
    ["get_attachment", "Download an attachment from an email message", ["messageId", "attachmentId"]],
  ],
  slack: [
    ["post_message", "Post a message to a Slack channel", ["channel", "text"]],
    ["reply_thread", "Reply to a message thread in a channel", ["channel", "threadTs", "text"]],
    ["list_channels", "List public and private channels in the workspace", ["limit"]],
    ["channel_history", "Get recent messages from a channel", ["channel", "limit"]],
    ["search_messages", "Search Slack messages across channels", ["query"]],
    ["add_reaction", "Add an emoji reaction to a message", ["channel", "timestamp", "emoji"]],
    ["get_user_profile", "Get a workspace member's profile and status", ["userId"]],
    ["list_users", "List members of the workspace", ["limit"]],
    ["set_status", "Set your own Slack status text and emoji", ["text", "emoji"]],
  ],
  drive: [
    ["search_files", "Search Google Drive for files and documents by name or content", ["query"]],
    ["read_file", "Read the text content of a Google Doc, Sheet or file in Drive", ["fileId"]],
    ["create_document", "Create a new Google Docs document", ["title", "content"]],
    ["share_file", "Share a Drive file with people and set their permissions", ["fileId", "email", "role"]],
    ["list_recent", "List recently modified files in Drive", ["limit"]],
    ["move_file", "Move a file into another Drive folder", ["fileId", "folderId"]],
    ["create_folder", "Create a folder in Drive", ["name", "parentId"]],
    [
      "update_spreadsheet",
      "Write values to cells in a Google Sheets spreadsheet",
      ["fileId", "range", "values"],
    ],
    ["export_pdf", "Export a Drive document as PDF", ["fileId"]],
  ],
  calendar: [
    ["list_events", "List upcoming calendar events in a time range", ["calendarId", "timeMin", "timeMax"]],
    [
      "create_event",
      "Create a calendar event and invite attendees",
      ["summary", "start", "end", "attendees"],
    ],
    ["update_event", "Change the time, title or attendees of an existing event", ["eventId", "start", "end"]],
    ["delete_event", "Cancel and delete a calendar event", ["eventId"]],
    ["find_free_time", "Find free time slots when all attendees are available", ["attendees", "duration"]],
    [
      "respond_to_invite",
      "Accept, decline or tentatively accept a meeting invitation",
      ["eventId", "response"],
    ],
    ["list_calendars", "List the calendars the user can see", []],
  ],
  github: [
    ["create_issue", "Open a new issue in a GitHub repository", ["owner", "repo", "title", "body"]],
    ["list_issues", "List issues in a repository with filters", ["owner", "repo", "state", "labels"]],
    ["create_pull_request", "Open a pull request from a branch", ["owner", "repo", "head", "base", "title"]],
    ["list_pull_requests", "List open pull requests in a repository", ["owner", "repo", "state"]],
    ["merge_pull_request", "Merge a pull request", ["owner", "repo", "pullNumber"]],
    ["get_file_contents", "Get the contents of a file in a repository", ["owner", "repo", "path", "ref"]],
    ["search_code", "Search source code across GitHub repositories", ["query"]],
    ["add_issue_comment", "Comment on an issue or pull request", ["owner", "repo", "issueNumber", "body"]],
    ["list_commits", "List commits on a branch", ["owner", "repo", "sha"]],
    ["create_branch", "Create a new branch in a repository", ["owner", "repo", "branch", "from"]],
    ["get_workflow_runs", "List GitHub Actions CI workflow runs and their status", ["owner", "repo"]],
  ],
  search: [
    ["web_search", "Search the web and return result titles, links and snippets", ["query", "count"]],
    ["fetch_url", "Fetch a web page and return its text as markdown", ["url"]],
    ["news_search", "Search recent news articles", ["query", "freshness"]],
    ["image_search", "Search the web for images", ["query"]],
    ["search_papers", "Search academic papers on arXiv and Semantic Scholar", ["query", "year"]],
  ],
  files: [
    ["read_text_file", "Read a text file from the local filesystem", ["path"]],
    ["write_file", "Create or overwrite a local file with content", ["path", "content"]],
    ["edit_file", "Apply line edits to a local text file", ["path", "edits"]],
    ["list_directory", "List files and folders in a local directory", ["path"]],
    ["move_path", "Move or rename a local file or directory", ["source", "destination"]],
    ["search_paths", "Find local files whose names match a glob pattern", ["path", "pattern"]],
    ["get_file_info", "Get size, timestamps and permissions of a local file", ["path"]],
    ["create_directory", "Create a local directory", ["path"]],
  ],
};

export function catalogue(): ToolRef[] {
  const out: ToolRef[] = [];
  for (const [account, specs] of Object.entries(SPECS)) {
    for (const [name, description, params] of specs) {
      out.push({
        qualifiedName: qualify(account, name),
        accountId: account,
        serverId: account,
        toolName: name,
        description,
        inputSchema: {
          type: "object",
          properties: Object.fromEntries(params.map((p) => [p, { type: "string" }])),
        },
        hash: `hash-${account}-${name}`,
        trust: [],
      });
    }
  }
  return out;
}

/** Realistic task prompts and the tool a good search must return in the top 5. */
export const QUALITY_SET: [prompt: string, expected: string][] = [
  ["send an email to my manager about the delay", "gmail__send_email"],
  ["find emails from the accountant about invoices", "gmail__search_emails"],
  ["draft a reply but don't send it yet", "gmail__create_draft"],
  ["post an update in the #launch channel", "slack__post_message"],
  ["what did people say in slack about the outage", "slack__search_messages"],
  ["react with a thumbs up emoji", "slack__add_reaction"],
  ["find the Q3 budget spreadsheet", "drive__search_files"],
  ["read the onboarding doc", "drive__read_file"],
  ["give alice edit access to the roadmap document", "drive__share_file"],
  ["what meetings do I have tomorrow", "calendar__list_events"],
  ["schedule a meeting with Bob next Tuesday at 3pm", "calendar__create_event"],
  ["when are Sam and Priya both free for 30 minutes", "calendar__find_free_time"],
  ["decline the invitation for friday standup", "calendar__respond_to_invite"],
  ["open a bug report in the api repo", "github__create_issue"],
  ["open a PR from my feature branch", "github__create_pull_request"],
  ["did CI pass on main", "github__get_workflow_runs"],
  ["look up the latest news about the MCP spec", "search__news_search"],
  ["search the web for bun compile cross platform", "search__web_search"],
  ["get the text of https://example.com/post", "search__fetch_url"],
  ["list what is in my ~/projects directory", "files__list_directory"],
  ["save these notes to a local file", "files__write_file"],
  ["rename report.txt to report-final.txt", "files__move_path"],
];

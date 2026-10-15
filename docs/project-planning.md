# Milestones and work item hierarchy

## Milestones

Open **Milestones** in the project's work item header or timeline. Create a milestone with a name, required date, and one active project member as its responsible person. The description can define the acceptance criterion. No linked task is required: a milestone is an independent project commitment.

The optional task section is collapsed by default. Its paginated search accepts task names, sequence numbers, and project identifiers such as `PROJECT-12`. Results show identifiers, state, and due date. Selected names remain visible when the query changes and can be removed independently. Links provide planning context only; they never automatically complete the milestone. Confirming fulfillment now requires a separate confirmation step.

A milestone is a date-only event, not a task duration. Both project and workspace timelines display a diamond on the shared date scale. Milestones do not change task completion statistics or the task-derived project period.

The responsible person or project lead/admin explicitly confirms fulfillment. Completed linked tasks never confirm a milestone automatically. Confirmation records the actor and timestamp, using the project timezone to determine whether it was late.

The responsible person or project lead/admin may change the required date only with a reason. The original date and change history remain available. Reopening a reached milestone also requires a reason. Reached plans cannot be edited until reopened. Only project leads/admins can delete milestones. Concurrent edits from the UI are checked against the revision last displayed.

Project templates include milestone names, descriptions, relative deadlines, and remapped task links. Fulfillment and source history are reset. The template form offers a responsible person for new milestones, defaulting to the project creator. Copying assignees preserves eligible existing owners; other milestones use the selected responsible person.

## Hierarchy

Lists and spreadsheets show a child only below its visible parent, using the existing expand control. When a parent is excluded by the current filter or has not been loaded, the child remains reachable as a top-level result. Cyclic legacy relationships cannot cause infinite expansion.

Project timelines support expandable tasks and subtasks. Workspace timelines support expandable projects, tasks, and subtasks, with explicit loading of further result pages. Expanding a tree does not change the number of projects.

Calendar and Kanban cards keep their actual date and state placement and expose a parent link. They do not render a second nested copy. Hierarchy changes affect presentation, not task counts, dates, assignees, or resource reservations.

## Timeline connections

The **Dependencies** checkbox shows or hides connections in both timelines. The view selector offers all scheduling dependencies, a chosen task's predecessors/successors, or conflicts and actual blockers only. Contextual links and duplicates remain in task details rather than cluttering the timeline.

Scheduling choices use finish-to-start, start-to-start, and finish-to-finish anchors. Finish-to-start is stored as `finish_to_start` with the reverse display `start_after_finish`; existing start-before/finish-before records retain their stored meaning and use clearer labels. Existing manual blocked-by/blocking, related, and duplicate relationships are retained. A future finish-start prerequisite is planned; it becomes an operational blocker when its successor should already start or has started while the prerequisite remains open.

Relationship writes reject self-links, cycles, invisible targets, and silent replacement of a different existing link. The selected tasks remain in the editor after a rejected save. Relationship activities run after commit. Reading/removing legacy links also respects both tasks' visibility.

An open blocking relation is highlighted; a conflicting date constraint is red, while planned links stay neutral. The toolbar has scoped status counts. Clicking a connection, or activating it with the keyboard, opens a non-modal side inspector with the actual connected tasks and dates, preserving the plan's position. Missing dates are explicitly not assessable. Changing a relation or task refreshes the connection data.

Collapsed tasks project their connections onto the visible parent. Collapsed projects show cross-project connections and an internal-relation indicator; expand them to inspect the concrete task arrows. Lines avoid intermediate task bars. No dependency action automatically shifts task dates or changes task status.

## Your work

The summary starts with today's/overdue tasks, later deadlines this week, blocked tasks with visible blocker links, and owned open milestones. Each section reports complete server-side counts and has pagination when needed. Task states can be changed with the existing state selector. Milestone links open their confirmation and history dialog.

All previous tabs, project information, statistics, workload, priority/state charts, and activity remain available. Tasks without deadlines remain accessible through **Assigned**. Loading failures are not presented as an empty workload.

## Deployment and verification

Apply Django migration `0128_project_milestones` before deploying the updated web app. Removing this migration removes milestone plans and histories; export these before any rollback.

Run the milestone, template, portfolio, and existing project contract tests in the isolated Docker test stack. Run web Vitest, type checking, production build, i18n synchronization, Ruff, OxLint, formatting checks, and React Doctor. Browser acceptance must use a disposable workspace, not a productive project.

The new target-locale strings are machine-translated and should receive native-language review before release.
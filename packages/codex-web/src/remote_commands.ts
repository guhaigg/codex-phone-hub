import type { ProviderThreadGoal } from '@codex-phone-hub/codex-native-api';

export type RemoteCommandAction =
  | 'show'
  | 'set'
  | 'pause'
  | 'resume'
  | 'clear'
  | 'switch'
  | 'unsupported';

export type RemoteCommandName =
  | 'help'
  | 'goal'
  | 'status'
  | 'model'
  | 'permissions'
  | 'plan'
  | 'resume'
  | 'fork'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'unknown';

export interface ParsedRemoteCommand {
  name: RemoteCommandName;
  action: RemoteCommandAction;
  objective?: string;
  model?: string;
  preset?: 'read-only' | 'default' | 'full-access';
  sandboxMode?: string;
  approvalPolicy?: string;
  text?: string;
  threadId?: string;
  command?: string;
}

export interface CodexWebCommandResult {
  type: 'command';
  command: {
    name: RemoteCommandName;
    action: RemoteCommandAction;
    message: string;
    goal: ProviderThreadGoal | null;
    draftPrompt?: string;
  };
}

export function parseRemoteCommand(text: string): ParsedRemoteCommand | null {
  const normalized = String(text ?? '').trim();
  if (!normalized.startsWith('/')) {
    return null;
  }
  if (normalized === '/help') {
    return { name: 'help', action: 'show' };
  }
  const goal = parseGoalCommand(normalized);
  if (goal) {
    return goal;
  }
  if (normalized === '/status') {
    return { name: 'status', action: 'show' };
  }
  const model = parseModelCommand(normalized);
  if (model) {
    return model;
  }
  const permissions = parsePermissionsCommand(normalized);
  if (permissions) {
    return permissions;
  }
  const plan = parsePlanCommand(normalized);
  if (plan) {
    return plan;
  }
  const resume = parseThreadCommand(normalized, '/resume', 'resume');
  if (resume) {
    return resume;
  }
  const fork = parseThreadCommand(normalized, '/fork', 'fork');
  if (fork) {
    return fork;
  }
  if (normalized === '/mcp') {
    return { name: 'mcp', action: 'show' };
  }
  if (normalized === '/skills') {
    return { name: 'skills', action: 'show' };
  }
  if (normalized === '/plugins') {
    return { name: 'plugins', action: 'show' };
  }
  const command = normalized.split(/\s+/u)[0] || normalized;
  return { name: 'unknown', action: 'unsupported', command };
}

function parseGoalCommand(normalized: string): ParsedRemoteCommand | null {
  if (!normalized.startsWith('/goal')) {
    return null;
  }
  const afterCommand = normalized.slice('/goal'.length);
  if (afterCommand && !/^\s/u.test(afterCommand)) {
    return null;
  }
  const rest = afterCommand.trim();
  if (!rest) {
    return { name: 'goal', action: 'show' };
  }
  const [firstToken = '', ...remaining] = rest.split(/\s+/u);
  const keyword = firstToken.toLowerCase();
  if (keyword === 'clear') {
    return { name: 'goal', action: 'clear' };
  }
  if (keyword === 'pause') {
    return { name: 'goal', action: 'pause' };
  }
  if (keyword === 'resume') {
    return { name: 'goal', action: 'resume' };
  }
  if (keyword === 'edit' || keyword === 'set') {
    const objective = remaining.join(' ').trim();
    return objective ? { name: 'goal', action: 'set', objective } : { name: 'goal', action: 'show' };
  }
  return { name: 'goal', action: 'set', objective: rest };
}

function parseModelCommand(normalized: string): ParsedRemoteCommand | null {
  if (!normalized.startsWith('/model')) {
    return null;
  }
  const rest = restAfterCommand(normalized, '/model');
  if (rest === null) {
    return null;
  }
  return rest ? { name: 'model', action: 'set', model: rest } : { name: 'model', action: 'show' };
}

function parsePermissionsCommand(normalized: string): ParsedRemoteCommand | null {
  if (!normalized.startsWith('/permissions')) {
    return null;
  }
  const rest = restAfterCommand(normalized, '/permissions');
  if (rest === null) {
    return null;
  }
  if (!rest) {
    return { name: 'permissions', action: 'show' };
  }
  if (rest === 'read-only' || rest === 'default' || rest === 'full-access') {
    return { name: 'permissions', action: 'set', preset: rest };
  }
  const tokens = rest.split(/\s+/u);
  const sandboxIndex = tokens.indexOf('sandbox');
  const approvalIndex = tokens.indexOf('approval');
  const sandboxMode = sandboxIndex >= 0 ? tokens[sandboxIndex + 1] : undefined;
  const approvalPolicy = approvalIndex >= 0 ? tokens[approvalIndex + 1] : undefined;
  if (sandboxMode || approvalPolicy) {
    return { name: 'permissions', action: 'set', sandboxMode, approvalPolicy };
  }
  return { name: 'permissions', action: 'unsupported', command: `/permissions ${rest}` };
}

function parsePlanCommand(normalized: string): ParsedRemoteCommand | null {
  if (!normalized.startsWith('/plan')) {
    return null;
  }
  const rest = restAfterCommand(normalized, '/plan');
  if (rest === null) {
    return null;
  }
  return { name: 'plan', action: 'switch', text: rest || undefined };
}

function parseThreadCommand(
  normalized: string,
  commandName: '/resume' | '/fork',
  name: 'resume' | 'fork',
): ParsedRemoteCommand | null {
  if (!normalized.startsWith(commandName)) {
    return null;
  }
  const rest = restAfterCommand(normalized, commandName);
  if (rest === null) {
    return null;
  }
  return rest
    ? { name, action: name === 'resume' ? 'resume' : 'unsupported', threadId: rest }
    : { name, action: 'unsupported', command: commandName };
}

function restAfterCommand(normalized: string, command: string): string | null {
  const rest = normalized.slice(command.length);
  if (rest && !/^\s/u.test(rest)) {
    return null;
  }
  return rest.trim();
}

export function createHelpCommandResult(helpReportPath: string | null): CodexWebCommandResult {
  const guideLine = helpReportPath
    ? `完整说明：[Codex Web 帮助文档](${helpReportPath})`
    : '完整说明：请在 Reports 页面打开 Codex Web 帮助文档。';
  return {
    type: 'command',
    command: {
      name: 'help',
      action: 'show',
      message: [
        '支持的命令：',
        '- `/help` - 显示这份命令列表。',
        '- `/status` - 显示当前远程工作台、模型、权限、目标和运行态。',
        '- `/model` - 显示当前模型；`/model <id>` 切换当前会话模型。',
        '- `/permissions` - 显示沙箱和审批；支持 `read-only`、`default`、`full-access` 预设。',
        '- `/plan [text]` - 切换当前会话到计划协作模式。',
        '- `/goal` - 显示当前会话的目标。',
        '- `/goal <objective>` - 设置当前会话目标。',
        '- `/goal set <objective>` 或 `/goal edit <objective>` - 替换当前会话目标。',
        '- `/goal pause` - 暂停当前目标。',
        '- `/goal resume` - 恢复当前目标。',
        '- `/goal clear` - 清除当前会话目标。',
        '- `/resume <threadId>` - 继续已有 Codex thread。',
        '- `/fork <threadId>` - 请求 fork；当前 runtime 未提供能力时会明确提示不支持。',
        '- `/mcp`、`/skills`、`/plugins` - 查看 Codex 生态状态摘要。',
        '',
        guideLine,
      ].join('\n'),
      goal: null,
    },
  };
}

export function createGoalCommandResult({
  action,
  goal,
  message,
}: {
  action: RemoteCommandAction;
  goal: ProviderThreadGoal | null;
  message: string;
}): CodexWebCommandResult {
  return {
    type: 'command',
    command: {
      name: 'goal',
      action,
      message,
      goal,
    },
  };
}

export function createSimpleCommandResult({
  name,
  action = 'show',
  message,
  draftPrompt,
}: {
  name: RemoteCommandName;
  action?: RemoteCommandAction;
  message: string;
  draftPrompt?: string;
}): CodexWebCommandResult {
  return {
    type: 'command',
    command: {
      name,
      action,
      message,
      goal: null,
      ...(draftPrompt ? { draftPrompt } : {}),
    },
  };
}

export function formatGoalMessage(goal: ProviderThreadGoal | null): string {
  if (!goal) {
    return 'No goal is set.';
  }
  const status = goal.status ? ` (${goal.status})` : '';
  return `Goal${status}: ${goal.objective}`;
}

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

import type { AgentAction } from './agentExplorer';

export class AgentChatViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;

  private messageSubscription: vscode.Disposable | undefined;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    webviewView.webview.html = this.getHtml();
    this.messageSubscription?.dispose();
    this.messageSubscription = webviewView.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'sendPrompt' &&
          'prompt' in message &&
          typeof message.prompt === 'string'
        ) {
          const prompt = message.prompt.trim();
          if (!prompt) {
            return;
          }
          this.postResult(
            'Agent',
            'Demo response only. This prompt was not sent to a model; Python backend integration is not connected yet.',
            true,
          );
        } else if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'runAction' &&
          'command' in message &&
          typeof message.command === 'string' &&
          isAgentAction(message.command)
        ) {
          void vscode.commands.executeCommand(message.command);
        }
      },
    );
    webviewView.onDidDispose(() => {
      this.messageSubscription?.dispose();
      this.messageSubscription = undefined;
      this.view = undefined;
    });
  }

  async showResult(
    title: string,
    content: string,
    placeholder = false,
  ): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand('agenticIde.chat.focus');
    }
    this.view?.show?.(true);
    this.postResult(title, content, placeholder);
  }

  async showError(title: string, content: string): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand('agenticIde.chat.focus');
    }
    this.view?.show?.(true);
    void this.view?.webview.postMessage({
      type: 'error',
      title,
      content,
    });
  }

  dispose(): void {
    this.messageSubscription?.dispose();
  }

  private postResult(
    title: string,
    content: string,
    placeholder: boolean,
  ): void {
    void this.view?.webview.postMessage({
      type: 'result',
      title,
      content,
      placeholder,
    });
  }

  private getHtml(): string {
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Agent Chat</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body {
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-editorWarning-foreground); }
    .status { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    #messages { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }
    .message { padding: 9px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
    .message-title { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; margin-bottom: 5px; }
    .badge { color: var(--vscode-editorWarning-foreground); font-size: 0.8em; font-weight: 400; }
    .error { border-color: var(--vscode-inputValidation-errorBorder); }
    .error .message-title { color: var(--vscode-errorForeground); }
    .content { white-space: pre-wrap; overflow-wrap: anywhere; }
    .empty { color: var(--vscode-descriptionForeground); line-height: 1.5; }
    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 72px;
      resize: vertical;
      padding: 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      font: inherit;
    }
    button {
      width: 100%;
      margin-top: 8px;
      padding: 7px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 4px;
      font: inherit;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
    .actions { display: grid; gap: 6px; margin-top: 12px; }
    .actions button { margin: 0; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <div class="header"><span class="dot"></span><strong>Agentic IDE</strong></div>
  <div class="status">Python backend not connected · Chat is a UI preview</div>
  <div id="messages" aria-live="polite">
    <div class="empty">Ask a question to preview the chat experience. Messages are not sent to a model in this milestone.</div>
  </div>
  <form id="chat-form">
    <textarea id="prompt" aria-label="Message" placeholder="Ask about your codebase…" maxlength="4000"></textarea>
    <button type="submit">Send preview message</button>
  </form>
  <div class="actions" aria-label="Agent actions">
    <button type="button" data-command="agenticIde.listWorkspaceFiles">List workspace files</button>
    <button type="button" data-command="agenticIde.searchCodebase">Search codebase</button>
    <button type="button" data-command="agenticIde.readSelectedFile">Read selected file</button>
    <button type="button" data-command="agenticIde.summarizeSelectedFile">Summarize selected file</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('chat-form');
    const promptInput = document.getElementById('prompt');
    const messages = document.getElementById('messages');
    const sendButton = form.querySelector('button');

    function addMessage(title, content, placeholder, isError) {
      const empty = messages.querySelector('.empty');
      if (empty) empty.remove();
      const card = document.createElement('section');
      card.className = isError ? 'message error' : 'message';
      const heading = document.createElement('div');
      heading.className = 'message-title';
      const label = document.createElement('span');
      label.textContent = title;
      heading.appendChild(label);
      if (placeholder) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'PREVIEW';
        heading.appendChild(badge);
      }
      const body = document.createElement('div');
      body.className = 'content';
      body.textContent = content;
      card.append(heading, body);
      messages.appendChild(card);
      card.scrollIntoView({ block: 'nearest' });
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = promptInput.value.trim();
      if (!prompt) return;
      addMessage('You', prompt, false);
      promptInput.value = '';
      sendButton.disabled = true;
      sendButton.textContent = 'Preparing preview…';
      vscode.postMessage({ type: 'sendPrompt', prompt });
    });

    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({
          type: 'runAction',
          command: button.getAttribute('data-command')
        });
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message && (message.type === 'result' || message.type === 'error')) {
        sendButton.disabled = false;
        sendButton.textContent = 'Send preview message';
        promptInput.focus();
      }
      if (message && message.type === 'result') {
        addMessage(message.title, message.content, message.placeholder);
      } else if (message && message.type === 'error') {
        addMessage(message.title, message.content, false, true);
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  return randomBytes(16).toString('hex');
}

function isAgentAction(command: string): command is AgentAction {
  return (
    command === 'agenticIde.listWorkspaceFiles' ||
    command === 'agenticIde.searchCodebase' ||
    command === 'agenticIde.readSelectedFile' ||
    command === 'agenticIde.summarizeSelectedFile'
  );
}

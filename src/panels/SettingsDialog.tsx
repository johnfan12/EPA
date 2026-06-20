import { Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useWorkspaceStore } from "../store";
import type { ProviderSettings } from "../types";

export function SettingsDialog({
  settings,
  onClose,
  onSaved,
}: {
  settings: ProviderSettings;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const setApiKey = useWorkspaceStore((state) => state.setApiKey);
  const [provider, setProvider] = useState(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [apiEndpoint, setApiEndpoint] = useState(settings.apiEndpoint ?? "");
  const [apiKey, setLocalApiKey] = useState("");
  const [status, setStatus] = useState("");

  // Load the saved key for the selected provider from the OS credential store.
  useEffect(() => {
    let active = true;
    setStatus("");
    api
      .loadApiKey(provider)
      .then((key) => {
        if (active) setLocalApiKey(key ?? "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [provider]);

  const saveSettings = async () => {
    await api.saveProviderSettings({ provider, model, apiEndpoint });
    if (apiKey.trim()) {
      await api.saveApiKey(provider, apiKey.trim());
      setApiKey(provider, apiKey.trim());
    }
    await onSaved();
    onClose();
  };

  const clearKey = async () => {
    await api.deleteApiKey(provider);
    setApiKey(provider, "");
    setLocalApiKey("");
    setStatus("已清除本机保存的 key。");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="row-between">
          <div>
            <p className="eyebrow">Provider</p>
            <h2>模型与密钥设置</h2>
          </div>
          <button className="icon-button subtle" onClick={onClose}>关闭</button>
        </div>

        <div className="form-grid">
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型名，如 gpt-4.1 / claude-sonnet-4-5" />
        </div>
        <input
          value={apiEndpoint}
          onChange={(event) => setApiEndpoint(event.target.value)}
          placeholder="自定义 API Endpoint，留空使用官方地址"
        />
        <div className="endpoint-hint">
          <p>
            <strong>留空</strong>即用官方地址。自定义时填到 <code>/v1</code> 为止即可，会自动补全请求路径：
          </p>
          <ul>
            <li>
              OpenAI 及兼容网关（DeepSeek / Moonshot / OpenRouter / Azure 代理等）：填
              <code>https://你的网关/v1</code>，自动调用 <code>/chat/completions</code>
            </li>
            <li>
              Anthropic：填 <code>https://你的网关/v1</code>，自动调用 <code>/messages</code>
            </li>
          </ul>
          <p>
            也可直接粘贴<strong>完整 endpoint</strong>（已包含 <code>/chat/completions</code> 或 <code>/messages</code>），将原样请求。
            若仍 404，多半是 provider 选错或网关只支持其中一种协议。
          </p>
        </div>
        <input
          value={apiKey}
          onChange={(event) => setLocalApiKey(event.target.value)}
          placeholder="API key"
          type="password"
        />
        <p className="muted-text">
          API key 安全保存在本机系统凭据库（Windows 凭据管理器 / macOS 钥匙串），下次启动自动载入，不写入 SQLite，也不随项目同步。
        </p>
        {status ? <p className="muted-text">{status}</p> : null}
        <div className="button-row">
          <button className="icon-button subtle" onClick={clearKey} title="从本机删除已保存的 key">
            <Trash2 size={16} />
            <span>清除已保存 key</span>
          </button>
          <button className="primary-button" onClick={saveSettings}>
            <Save size={16} />
            <span>保存设置</span>
          </button>
        </div>
      </div>
    </div>
  );
}

//! Secure, persistent local storage for API keys via the OS credential store
//! (Windows Credential Manager / macOS Keychain / Linux Secret Service).

use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "research-idea-agent";

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    let provider = provider.trim();
    let api_key = api_key.trim();
    if provider.is_empty() || api_key.is_empty() {
        return Err("provider 和 api_key 不能为空".to_string());
    }
    entry(provider)?
        .set_password(api_key)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn load_api_key(provider: String) -> Result<Option<String>, String> {
    match entry(provider.trim())?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    match entry(provider.trim())?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

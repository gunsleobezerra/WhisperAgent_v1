use std::fs;
use std::path::PathBuf;

pub struct SoulManager {
    base_path: PathBuf,
}

impl SoulManager {
    pub fn new(app_dir: Option<PathBuf>) -> Self {
        let base_path = app_dir
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
            .join(".agents");
        
        Self { base_path }
    }

    pub fn load_soul(&self) -> Result<String, String> {
        let soul_path = self.base_path.join("soul.md");
        if soul_path.exists() {
            fs::read_to_string(&soul_path)
                .map_err(|e| format!("Erro ao ler soul.md: {}", e))
        } else {
            Ok(String::from("Você é o WhisperAgent, um agente autônomo com uso de ferramentas."))
        }
    }

    pub fn format_system_prompt(&self, persona_prompt: &str) -> Result<String, String> {
        let soul = self.load_soul()?;
        
        // Concatena as diretrizes fundamentais (Soul) com o prompt específico da Persona
        let mut final_prompt = soul;
        final_prompt.push_str("\n\n--- DIRETRIZES DA PERSONA ATUAL ---\n");
        final_prompt.push_str(persona_prompt);
        
        // Adiciona informações de sistema dinâmicas
        let os_info = std::env::consts::OS;
        final_prompt.push_str(&format!("\n\n--- AWARENESS ---\nSistema Operacional hospedeiro: {}", os_info));
        
        Ok(final_prompt)
    }
}

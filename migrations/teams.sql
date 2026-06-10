-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  team_id       VARCHAR(100) NOT NULL UNIQUE,
  username      VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_teams_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Team members table (agent assignments)
CREATE TABLE IF NOT EXISTS team_members (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  team_id         VARCHAR(100) NOT NULL,
  owner_username  VARCHAR(255) NOT NULL,
  agent_username  VARCHAR(255) NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_agent (team_id, agent_username),
  INDEX idx_team_members_team (team_id),
  INDEX idx_team_members_agent (agent_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

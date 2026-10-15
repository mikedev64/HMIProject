package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	usersFilePath    = "hmi-config/users.json"
	defaultAlgorithm = "pbkdf2-sha256"
	defaultIter      = 100000
)

const (
	LevelViewer   = "viewer"
	LevelOperator = "operator"
	LevelAdmin    = "admin"
)

const (
	maxLoginFailures = 5
	lockoutDuration  = 60 * time.Second
	minPasswordLen   = 6
)

func levelRank(level string) int {
	switch level {
	case LevelAdmin:
		return 3
	case LevelOperator:
		return 2
	case LevelViewer:
		return 1
	}
	return 0
}

type UserAccount struct {
	Username string `json:"username"`
	Level    string `json:"level"`
	Salt     string `json:"salt"`
	Hash     string `json:"hash"`
}

type UsersFile struct {
	Version    int           `json:"version"`
	Algorithm  string        `json:"algorithm"`
	Iterations int           `json:"iterations"`
	Users      []UserAccount `json:"users"`
}

type SessionInfo struct {
	Authenticated bool   `json:"authenticated"`
	Username      string `json:"username,omitempty"`
	Level         string `json:"level,omitempty"`
	Since         int64  `json:"since,omitempty"`
}

type authService struct {
	mu     sync.Mutex
	file   UsersFile
	byUser map[string]UserAccount
	active *SessionInfo
	path   string

	failures    map[string]int
	lockedUntil map[string]int64
}

type UserSummary struct {
	Username string `json:"username"`
	Level    string `json:"level"`
}

func (a *App) initAuth() error {
	svc, err := newAuthService(usersFilePath)
	if err != nil {
		return err
	}
	a.auth = svc
	return nil
}

func newAuthService(path string) (*authService, error) {
	s := &authService{
		path:        path,
		byUser:      map[string]UserAccount{},
		failures:    map[string]int{},
		lockedUntil: map[string]int64{},
	}

	if err := s.load(); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}

		if seedErr := seedUsersFile(path); seedErr != nil {
			return nil, seedErr
		}
		fmt.Printf("[auth] %s no existía: creado con usuarios por defecto\n", path)
		if err := s.load(); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *authService) load() error {
	raw, err := os.ReadFile(filepath.Clean(s.path))
	if err != nil {
		return err
	}
	var f UsersFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return fmt.Errorf("users.json inválido: %w", err)
	}
	if f.Algorithm != defaultAlgorithm {
		return fmt.Errorf("algoritmo %q no soportado (se espera %s)", f.Algorithm, defaultAlgorithm)
	}
	if f.Iterations <= 0 {
		f.Iterations = defaultIter
	}
	s.file = f
	s.byUser = make(map[string]UserAccount, len(f.Users))
	for _, u := range f.Users {
		s.byUser[u.Username] = u
	}
	return nil
}

func seedUsersFile(path string) error {
	defaults := []struct {
		user  string
		pass  string
		level string
	}{
		{"admin", "admin123", LevelAdmin},
		{"operador", "operador123", LevelOperator},
		{"consulta", "consulta123", LevelViewer},
	}

	out := UsersFile{Version: 1, Algorithm: defaultAlgorithm, Iterations: defaultIter}
	for _, d := range defaults {
		salt := make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			return err
		}
		hash, err := deriveKey(d.pass, salt, out.Iterations)
		if err != nil {
			return err
		}
		out.Users = append(out.Users, UserAccount{
			Username: d.user,
			Level:    d.level,
			Salt:     base64.StdEncoding.EncodeToString(salt),
			Hash:     base64.StdEncoding.EncodeToString(hash),
		})
	}

	raw, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Clean(path), append(raw, '\n'), 0o600)
}

func deriveKey(password string, salt []byte, iterations int) ([]byte, error) {
	return pbkdf2.Key(sha256.New, password, salt, iterations, 32)
}

func (s *authService) Login(username, password string) (SessionInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UnixMilli()
	if until, ok := s.lockedUntil[username]; ok {
		if now < until {
			rest := int((until-now)/1000) + 1
			return SessionInfo{}, fmt.Errorf("cuenta bloqueada tras %d intentos fallidos: reintenta en %d s", maxLoginFailures, rest)
		}

		delete(s.lockedUntil, username)
		delete(s.failures, username)
	}

	fail := func() (SessionInfo, error) {
		s.failures[username]++
		if s.failures[username] >= maxLoginFailures {
			s.lockedUntil[username] = now + int64(lockoutDuration/time.Millisecond)
			delete(s.failures, username)
			return SessionInfo{}, fmt.Errorf("cuenta bloqueada tras %d intentos fallidos: reintenta en %d s", maxLoginFailures, int(lockoutDuration/time.Second))
		}
		return SessionInfo{}, errors.New("usuario o contraseña incorrectos")
	}

	u, ok := s.byUser[username]
	if !ok {
		return fail()
	}
	salt, err := base64.StdEncoding.DecodeString(u.Salt)
	if err != nil {
		return fail()
	}
	want, err := base64.StdEncoding.DecodeString(u.Hash)
	if err != nil {
		return fail()
	}
	got, err := deriveKey(password, salt, s.file.Iterations)
	if err != nil {
		return SessionInfo{}, err
	}
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return fail()
	}

	delete(s.failures, username)
	delete(s.lockedUntil, username)
	s.active = &SessionInfo{
		Authenticated: true,
		Username:      u.Username,
		Level:         u.Level,
		Since:         time.Now().UnixMilli(),
	}
	fmt.Printf("[auth] sesión iniciada: %s (%s)\n", u.Username, u.Level)
	return *s.active, nil
}

func (s *authService) Logout() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active != nil {
		fmt.Printf("[auth] sesión cerrada: %s\n", s.active.Username)
	}
	s.active = nil
}

func (s *authService) Session() SessionInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return SessionInfo{}
	}
	return *s.active
}

func (s *authService) Require(minLevel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return errors.New("inicia sesión para escribir en el PLC")
	}
	if levelRank(s.active.Level) < levelRank(minLevel) {
		return fmt.Errorf("el nivel %q no puede realizar esta operación (se requiere %s)", s.active.Level, minLevel)
	}
	return nil
}

func (s *authService) ListUsers() []UserSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]UserSummary, 0, len(s.file.Users))
	for _, u := range s.file.Users {
		out = append(out, UserSummary{Username: u.Username, Level: u.Level})
	}
	return out
}

func (s *authService) SetUser(username, password, level string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("el usuario no puede estar vacío")
	}
	if level != LevelViewer && level != LevelOperator && level != LevelAdmin {
		return "", fmt.Errorf("nivel %q desconocido (viewer | operator | admin)", level)
	}
	if password != "" && len(password) < minPasswordLen {
		return "", fmt.Errorf("la contraseña debe tener al menos %d caracteres", minPasswordLen)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	found := -1
	oldLevel := ""
	for i, u := range s.file.Users {
		if u.Username == username {
			found = i
			oldLevel = u.Level
			break
		}
	}

	if found >= 0 && password == "" {

		s.file.Users[found].Level = level
	} else {
		if password == "" {
			return "", errors.New("la contraseña no puede estar vacía")
		}
		salt := make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			return "", err
		}
		hash, err := deriveKey(password, salt, s.file.Iterations)
		if err != nil {
			return "", err
		}
		entry := UserAccount{
			Username: username,
			Level:    level,
			Salt:     base64.StdEncoding.EncodeToString(salt),
			Hash:     base64.StdEncoding.EncodeToString(hash),
		}
		if found >= 0 {
			s.file.Users[found] = entry
		} else {
			s.file.Users = append(s.file.Users, entry)
		}
	}

	if err := s.saveLocked(); err != nil {
		return "", err
	}
	s.reindexLocked()
	return oldLevel, nil
}

func (s *authService) DeleteUser(username string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	idx := -1
	oldLevel := ""
	for i, u := range s.file.Users {
		if u.Username == username {
			idx = i
			oldLevel = u.Level
			break
		}
	}
	if idx < 0 {
		return "", fmt.Errorf("el usuario %q no existe", username)
	}
	if s.active != nil && s.active.Username == username {
		return "", errors.New("no se puede eliminar el usuario con la sesión activa")
	}
	if oldLevel == LevelAdmin {
		admins := 0
		for i, u := range s.file.Users {
			if i != idx && u.Level == LevelAdmin {
				admins++
			}
		}
		if admins == 0 {
			return "", errors.New("no se puede eliminar el último administrador")
		}
	}

	s.file.Users = append(s.file.Users[:idx], s.file.Users[idx+1:]...)
	if err := s.saveLocked(); err != nil {
		return "", err
	}
	s.reindexLocked()
	delete(s.failures, username)
	delete(s.lockedUntil, username)
	return oldLevel, nil
}

func (s *authService) reindexLocked() {
	s.byUser = make(map[string]UserAccount, len(s.file.Users))
	for _, u := range s.file.Users {
		s.byUser[u.Username] = u
	}
}

func (s *authService) saveLocked() error {
	raw, err := json.MarshalIndent(s.file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (a *App) Login(username, password string) (SessionInfo, error) {
	if a.auth == nil {
		return SessionInfo{}, errors.New("autenticación no inicializada")
	}
	return a.auth.Login(username, password)
}

func (a *App) Logout() {
	if a.auth != nil {
		a.auth.Logout()
	}
}

func (a *App) GetSession() SessionInfo {
	if a.auth == nil {
		return SessionInfo{}
	}
	return a.auth.Session()
}

func (a *App) requireAdmin() error {
	if a.auth == nil {
		return errors.New("autenticación no inicializada")
	}
	return a.auth.Require(LevelAdmin)
}

func (a *App) ListUsers() ([]UserSummary, error) {
	if err := a.requireAdmin(); err != nil {
		return nil, err
	}
	return a.auth.ListUsers(), nil
}

func (a *App) SetUser(username, password, level string) error {
	if err := a.requireAdmin(); err != nil {
		return err
	}
	oldLevel, err := a.auth.SetUser(username, password, level)
	a.auditWrite("usuarios", "usuario: "+username, "", oldLevel, level, err)
	return err
}

func (a *App) DeleteUser(username string) error {
	if err := a.requireAdmin(); err != nil {
		return err
	}
	oldLevel, err := a.auth.DeleteUser(username)
	a.auditWrite("usuarios", "eliminar usuario: "+username, "", oldLevel, "", err)
	return err
}

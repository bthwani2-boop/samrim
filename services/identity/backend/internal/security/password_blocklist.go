package security

const passwordBlocklistVersion = "identity-passwords-v3"

func PasswordBlocklistVersion() string {
	return passwordBlocklistVersion
}

func passwordInBlocklist(password string) bool {
	_, blocked := passwordBlocklistGenerated[password]
	return blocked
}

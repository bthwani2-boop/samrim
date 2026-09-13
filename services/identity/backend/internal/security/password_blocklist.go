package security

const passwordBlocklistVersion = "identity-passwords-v2"

func PasswordBlocklistVersion() string {
	return passwordBlocklistVersion
}

func passwordInBlocklist(password string) bool {
	_, blocked := passwordBlocklistGenerated[password]
	return blocked
}

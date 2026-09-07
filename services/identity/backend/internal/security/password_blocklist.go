package security

const passwordBlocklistVersion = "identity-passwords-v1"

var commonPasswordBlocklistV1 = map[string]struct{}{
	"123456789012345": {}, "1234567890123456": {}, "123456789012345678": {},
	"1q2w3e4r5t6y7u8": {}, "1qaz2wsx3edcvfr": {}, "qwertyuiopasdfg": {},
	"qwertyuiopasdfgh": {}, "qwerty1234567890": {}, "asdfghjklqwerty": {},
	"zxcvbnmasdfghj": {}, "abcdefghijklmno": {}, "passwordpassword": {},
	"password123456": {}, "password1234567": {}, "password20242025": {},
	"password20252026": {}, "letmeinletmein": {}, "letmein123456789": {},
	"welcome123456789": {}, "welcomehome12345": {}, "adminadminadmin": {},
	"admin123456789": {}, "changeme12345678": {}, "changemeplease123": {},
	"iloveyouiloveyou": {}, "iloveyou1234567": {}, "trustnoone123456": {},
	"secretsecret1234": {}, "superman12345678": {}, "batman123456789": {},
	"footballfootball": {}, "baseballbaseball": {}, "basketball12345": {},
	"dragonball123456": {}, "monkeymonkey1234": {}, "masterpassword123": {},
	"sunshine12345678": {}, "princess1234567": {}, "lovelylovely1234": {},
	"freedomfreedom12": {}, "whateverwhatever": {}, "loginlogin123456": {},
	"passw0rdpassw0rd": {}, "p@sswordp@ssword": {}, "password-password": {},
	"welcome-welcome": {}, "let-me-in-let-me-in": {}, "correcthorsebatterystaple": {},
	"bthwani-password": {}, "bthwani2026password": {}, "samrim-password": {},
	"samrim2026password": {}, "samrim-samrim-2026": {}, "identity-password": {},
	"identityidentity": {}, "control-panel-password": {}, "platform-owner-password": {},
}

func PasswordBlocklistVersion() string {
	return passwordBlocklistVersion
}

func passwordInBlocklist(password string) bool {
	_, blocked := commonPasswordBlocklistV1[password]
	return blocked
}

package transporthttp

import (
 "bytes"
 "encoding/binary"
 "mime/multipart"
 "net/http/httptest"
 "net/textproto"
 "testing"
)

func shortFormTestBox(kind string, payload []byte) []byte {
 b:=make([]byte,8+len(payload))
 binary.BigEndian.PutUint32(b[:4],uint32(len(b)))
 copy(b[4:8],kind)
 copy(b[8:],payload)
 return b
}

func marketingUploadRequest(t *testing.T, kind, mime string, data []byte) *httptest.ResponseRecorder {
 t.Helper()
 body:=new(bytes.Buffer)
 form:=multipart.NewWriter(body)
 fields:=map[string]string{
  "id":"content-test-01234","kind":kind,"titleAr":"Sample test reel",
  "targetType":"INFO","startsAt":"2030-01-01T10:00:00Z",
  "creator":"Demo Creator","sourceDescription":"Owned test material",
  "rightsStatement":"We have full rights to use these demo assets","rightsAttested":"true",
 }
 for name,value:=range fields {if err:=form.WriteField(name,value);err!=nil {t.Fatal(err)}}
 header:=make(textproto.MIMEHeader)
 header.Set("Content-Disposition", `form-data; name="file"; filename="clip.mp4"`)
 header.Set("Content-Type",mime)
 file,err:=form.CreatePart(header)
 if err!=nil {t.Fatal(err)}
 if _,err=file.Write(data);err!=nil {t.Fatal(err)}
 if err=form.Close();err!=nil {t.Fatal(err)}
 req:=httptest.NewRequest("POST","/dsh/operator/discovery-content",body)
 req.Header.Set("Content-Type",form.FormDataContentType())
 response:=httptest.NewRecorder()
 _,ok:=parseMarketingContentUpload(response,req)
 if kind=="SHORT_FORM" && mime=="video/mp4" && len(data)>32 {
  if !ok {t.Fatalf("expected accepted short video: %d %s",response.Code,response.Body.String())}
 } else if ok {
  t.Fatalf("invalid upload accepted: kind=%s type=%s",kind,mime)
 }
 return response
}

func TestShortFormMP4IsOnlyAdmittedForShortContent(t *testing.T) {
 data:=append(shortFormTestBox("ftyp",[]byte("isom0000")),shortFormTestBox("moov",[]byte("movie header"))...)
 data=append(data,shortFormTestBox("mdat",[]byte("video contents"))...)
 marketingUploadRequest(t,"SHORT_FORM","video/mp4",data)
 marketingUploadRequest(t,"BANNER","video/mp4",data)
 marketingUploadRequest(t,"CAROUSEL","video/mp4",data)
 marketingUploadRequest(t,"SHORT_FORM","application/octet-stream",data)
 marketingUploadRequest(t,"SHORT_FORM","video/mp4",[]byte("fake MP4"))
}

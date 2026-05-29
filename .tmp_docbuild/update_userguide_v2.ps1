$ErrorActionPreference = 'Continue'
$cr = [char]13

$src = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx"
$bak = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx.bak"
if (-not (Test-Path $bak)) { Copy-Item -Force $src $bak; Write-Host "Backup created" }
Write-Host "Opening doc..."

$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$doc = $w.Documents.Open($src)
Write-Host ("Opened. Paragraphs=" + $doc.Paragraphs.Count)

try {
  $headingTxt = "Send WhatsApp - Short Attendance"
  $subEn = "When to use it:"
  $subHi = "कब उपयोग करें:"

  # ----- 1. Hindi table T46 add row -----
  Write-Host "Adding Hindi table row..."
  $tHi = $doc.Tables.Item(46)
  $newRowHi = $tHi.Rows.Add()
  $newRowHi.Cells.Item(1).Range.Text = "Send WhatsApp - Short Attendance"
  $newRowHi.Cells.Item(2).Range.Text = "कम/NIL उपस्थिति की चेतावनी, लॉगिन लिंक के साथ"
  Write-Host "  Hindi table OK"

  # ----- 2. English table T18 add row -----
  Write-Host "Adding English table row..."
  $tEn = $doc.Tables.Item(18)
  $newRowEn = $tEn.Rows.Add()
  $newRowEn.Cells.Item(1).Range.Text = "Send WhatsApp - Short Attendance"
  $newRowEn.Cells.Item(2).Range.Text = "Low/NIL attendance reminder with login link"
  Write-Host "  English table OK"

  # ----- 3. Locate the two "Buttons:" / "बटन:" anchor lines (After certificate) -----
  # Walk all paragraphs once, capture both target line indexes by content.
  Write-Host "Scanning paragraphs..."
  $engButtonIdx = -1
  $hindiButtonIdx = -1
  $foundFirstEngLogin = $false
  $foundFirstHindiLogin = $false
  # Walk forwards. The After-certificate section is the LAST "Buttons: ..." line in English part,
  # and last "बटन: ..." line in Hindi part. Identify by following the certificate anchor body.
  $afterCertEnSeen = $false
  $afterCertHiSeen = $false
  for ($p = 1; $p -le $doc.Paragraphs.Count; $p++) {
    $t = $doc.Paragraphs.Item($p).Range.Text.TrimEnd($cr, [char]7)
    if ($t -eq "Send WhatsApp - After certificate") {
      # English heading occurs once, Hindi mirror once. First English, then Hindi.
      if (-not $afterCertEnSeen) { $afterCertEnSeen = $true; $afterCertEnHeadingIdx = $p }
      else { $afterCertHiSeen = $true; $afterCertHiHeadingIdx = $p }
    }
    if ($afterCertEnSeen -and $engButtonIdx -eq -1 -and $t.StartsWith("Buttons:") -and $p -gt $afterCertEnHeadingIdx) {
      $engButtonIdx = $p
    }
    if ($afterCertHiSeen -and $hindiButtonIdx -eq -1 -and $t.StartsWith("बटन:") -and $p -gt $afterCertHiHeadingIdx) {
      $hindiButtonIdx = $p
    }
  }
  Write-Host "  English Buttons idx: $engButtonIdx"
  Write-Host "  Hindi बटन idx: $hindiButtonIdx"
  if ($engButtonIdx -lt 0 -or $hindiButtonIdx -lt 0) { throw "Anchors missing" }

  # ----- 4. Insert Hindi detail (do this FIRST since it's later in doc, indexes will only shift forward) -----
  Write-Host "Inserting Hindi detail section..."
  $hindiButtonRange = $doc.Paragraphs.Item($hindiButtonIdx).Range
  $insertHindi = $cr + `
"Send WhatsApp - Short Attendance" + $cr + `
"कब उपयोग करें: जब प्रशिक्षण की अटेंडेंस/प्रगति कम या शून्य हो — चेतावनी देता है कि प्रशिक्षण अनिवार्य है, अन्यथा लोन डिस्बर्समेंट प्रभावित हो सकता है।" + $cr + `
"प्रिय प्रतिभागी," + $cr + `
"यह देखा गया है कि आपकी CM YUVA EDP ट्रेनिंग की अटेंडेंस/प्रगति वर्तमान में कम या NIL है। कृपया नियमित रूप से पोर्टल पर लॉगिन कर अपनी अनिवार्य (Mandatory) ट्रेनिंग पूर्ण करें।" + $cr + `
"" + $cr + `
"कृपया ध्यान दें कि CM YUVA EDP ट्रेनिंग अनिवार्य है। ट्रेनिंग पूर्ण न होने की स्थिति में आपके लोन डिस्बर्समेंट की प्रक्रिया प्रभावित हो सकती है।" + $cr + `
"" + $cr + `
"कृपया नीचे दिए गए 'लॉगिन करें' बटन पर क्लिक करके लॉगिन कीजिए।" + $cr + `
"" + $cr + `
"धन्यवाद," + $cr + `
"उद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ" + $cr + `
"बटन:  [ लॉगिन करें (Login) ]  "
  $insPtHi = $doc.Range($hindiButtonRange.End, $hindiButtonRange.End)
  $insPtHi.InsertAfter($insertHindi)
  Write-Host "  Hindi inserted"

  # Apply formatting to inserted Hindi block
  for ($p = $hindiButtonIdx + 1; $p -le [Math]::Min($hindiButtonIdx + 20, $doc.Paragraphs.Count); $p++) {
    $par = $doc.Paragraphs.Item($p)
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    if ($t -eq $headingTxt) {
      $par.Range.Bold = $true
    } elseif ($t.StartsWith($subHi)) {
      $par.Range.Bold = $false
      $sr = $doc.Range($par.Range.Start, $par.Range.Start + $subHi.Length)
      $sr.Bold = $true
    } elseif ($t.StartsWith("बटन:")) {
      $par.Range.Bold = $true
    }
  }

  # ----- 5. Insert English detail (after Hindi, since Hindi is later; insertion shifted nothing before engButtonIdx) -----
  Write-Host "Inserting English detail section..."
  $engButtonRange = $doc.Paragraphs.Item($engButtonIdx).Range
  $insertEnglish = $cr + `
"Send WhatsApp - Short Attendance" + $cr + `
"When to use it: When a beneficiary's training attendance/progress is low or NIL — warns that the training is mandatory and loan disbursement may be affected if not completed." + $cr + `
"प्रिय प्रतिभागी," + $cr + `
"यह देखा गया है कि आपकी CM YUVA EDP ट्रेनिंग की अटेंडेंस/प्रगति वर्तमान में कम या NIL है। कृपया नियमित रूप से पोर्टल पर लॉगिन कर अपनी अनिवार्य (Mandatory) ट्रेनिंग पूर्ण करें।" + $cr + `
"" + $cr + `
"कृपया ध्यान दें कि CM YUVA EDP ट्रेनिंग अनिवार्य है। ट्रेनिंग पूर्ण न होने की स्थिति में आपके लोन डिस्बर्समेंट की प्रक्रिया प्रभावित हो सकती है।" + $cr + `
"" + $cr + `
"कृपया नीचे दिए गए 'लॉगिन करें' बटन पर क्लिक करके लॉगिन कीजिए।" + $cr + `
"" + $cr + `
"धन्यवाद," + $cr + `
"उद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ" + $cr + `
"Buttons:  [ लॉगिन करें (Login) ]  "
  $insPtEn = $doc.Range($engButtonRange.End, $engButtonRange.End)
  $insPtEn.InsertAfter($insertEnglish)
  Write-Host "  English inserted"

  for ($p = $engButtonIdx + 1; $p -le [Math]::Min($engButtonIdx + 20, $doc.Paragraphs.Count); $p++) {
    $par = $doc.Paragraphs.Item($p)
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    if ($t -eq $headingTxt) {
      $par.Range.Bold = $true
    } elseif ($t.StartsWith($subEn)) {
      $par.Range.Bold = $false
      $sr = $doc.Range($par.Range.Start, $par.Range.Start + $subEn.Length)
      $sr.Bold = $true
    } elseif ($t.StartsWith("Buttons:")) {
      $par.Range.Bold = $true
    }
  }

  Write-Host "Saving..."
  $doc.Save()
  Write-Host "SAVED"
} catch {
  Write-Host ("ERROR: " + $_.Exception.Message)
  Write-Host $_.ScriptStackTrace
} finally {
  $doc.Close($false)
  $w.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($w) | Out-Null
}

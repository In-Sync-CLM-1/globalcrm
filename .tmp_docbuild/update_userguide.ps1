$ErrorActionPreference = 'Stop'
$src = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx"
$bak = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx.bak"
Copy-Item -Force $src $bak

$w = New-Object -ComObject Word.Application
$w.Visible = $false
$doc = $w.Documents.Open($src)

try {
  # ----------- 1. Hindi mapping table (T46) - add row -----------
  $tHi = $doc.Tables.Item(46)
  $newRowHi = $tHi.Rows.Add()
  $newRowHi.Cells.Item(1).Range.Text = "Send WhatsApp - Short Attendance"
  $newRowHi.Cells.Item(2).Range.Text = "कम/NIL उपस्थिति की चेतावनी, लॉगिन लिंक के साथ"

  # ----------- 2. Hindi detail section - insert after Hindi "After certificate" Buttons line -----------
  # Anchor: paragraph containing "बटन:" right after the last Hindi message (After certificate).
  # We find the Hindi Buttons paragraph for After certificate by walking from the section "Each message in full" Hindi heading.
  # Simpler: find the unique anchor text "मुख्यमंत्री युवा उद्यमी प्रशिक्षण पूर्ण करने" (only in Hindi After certificate body),
  # then walk forward to the next "बटन:" paragraph.
  $find = $doc.Content.Find
  $find.ClearFormatting()
  $find.Text = "मुख्यमंत्री युवा उद्यमी प्रशिक्षण पूर्ण करने"
  $find.Forward = $true
  $find.Wrap = 0  # wdFindStop
  # search whole doc; first hit is English (para ~388), second is Hindi (para ~790).
  $hits = @()
  $rng = $doc.Content
  $find2 = $rng.Find
  $find2.ClearFormatting()
  $find2.Text = "मुख्यमंत्री युवा उद्यमी प्रशिक्षण पूर्ण करने"
  $find2.Forward = $true
  $find2.Wrap = 0
  while ($find2.Execute()) {
    $hits += $rng.Start
    $rng.Start = $rng.End
    $rng.End = $doc.Content.End
  }
  Write-Output ("Hindi anchor hits: " + ($hits -join ","))

  $hindiAnchorStart = $hits[$hits.Count - 1]
  # Walk forward to find the "बटन:" line after this anchor.
  $hindiButtonRange = $null
  for ($p = 1; $p -le $doc.Paragraphs.Count; $p++) {
    $par = $doc.Paragraphs.Item($p)
    if ($par.Range.Start -gt $hindiAnchorStart) {
      $txt = $par.Range.Text
      if ($txt -match "^बटन:") { $hindiButtonRange = $par.Range; $hindiButtonParaIdx = $p; break }
    }
  }
  if (-not $hindiButtonRange) { throw "Hindi Buttons anchor not found" }
  Write-Output "Hindi Buttons paragraph: $hindiButtonParaIdx"

  # Build the Hindi insertion text.
  $cr = [char]13
  $hindiInsert = $cr + `
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

  # Insert at end of Hindi Buttons line (just before its trailing CR).
  $insertPoint = $doc.Range($hindiButtonRange.End, $hindiButtonRange.End)
  $insertPoint.InsertAfter($hindiInsert)

  # Apply formatting to the inserted heading + sub-heading + buttons line.
  # We located insertion by start position; the heading is the second paragraph after $hindiButtonParaIdx (blank, heading).
  # Re-walk to set bold on the heading and the "बटन:" line, and partial bold on "कब उपयोग करें:".
  $headingTxt = "Send WhatsApp - Short Attendance"
  $subTxt = "कब उपयोग करें:"
  $btnTxt = "बटन:  [ लॉगिन करें (Login) ]"
  for ($p = $hindiButtonParaIdx; $p -le [Math]::Min($hindiButtonParaIdx + 20, $doc.Paragraphs.Count); $p++) {
    $par = $doc.Paragraphs.Item($p)
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    if ($t -eq $headingTxt) { $par.Range.Bold = $true }
    elseif ($t.StartsWith($subTxt)) {
      $par.Range.Bold = $false
      # bold just the "कब उपयोग करें:" prefix
      $subRange = $doc.Range($par.Range.Start, $par.Range.Start + $subTxt.Length)
      $subRange.Bold = $true
    }
    elseif ($t.StartsWith("बटन:")) { $par.Range.Bold = $true }
  }

  # ----------- 3. English mapping table (T18) - add row -----------
  $tEn = $doc.Tables.Item(18)
  $newRowEn = $tEn.Rows.Add()
  $newRowEn.Cells.Item(1).Range.Text = "Send WhatsApp - Short Attendance"
  $newRowEn.Cells.Item(2).Range.Text = "Low/NIL attendance reminder with login link"

  # ----------- 4. English detail section - insert after English "After certificate" Buttons line -----------
  # Find first "मुख्यमंत्री युवा उद्यमी प्रशिक्षण पूर्ण करने" occurrence (English section).
  $rng = $doc.Content
  $find3 = $rng.Find
  $find3.ClearFormatting()
  $find3.Text = "मुख्यमंत्री युवा उद्यमी प्रशिक्षण पूर्ण करने"
  $find3.Forward = $true
  $find3.Wrap = 0
  $found = $find3.Execute()
  if (-not $found) { throw "English anchor not found" }
  $englishAnchorStart = $rng.Start
  $engButtonRange = $null
  for ($p = 1; $p -le $doc.Paragraphs.Count; $p++) {
    $par = $doc.Paragraphs.Item($p)
    if ($par.Range.Start -gt $englishAnchorStart) {
      $txt = $par.Range.Text
      if ($txt -match "^Buttons:") { $engButtonRange = $par.Range; $engButtonParaIdx = $p; break }
    }
  }
  if (-not $engButtonRange) { throw "English Buttons anchor not found" }
  Write-Output "English Buttons paragraph: $engButtonParaIdx"

  $englishInsert = $cr + `
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

  $insertPoint2 = $doc.Range($engButtonRange.End, $engButtonRange.End)
  $insertPoint2.InsertAfter($englishInsert)

  $subEn = "When to use it:"
  for ($p = $engButtonParaIdx; $p -le [Math]::Min($engButtonParaIdx + 20, $doc.Paragraphs.Count); $p++) {
    $par = $doc.Paragraphs.Item($p)
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    if ($t -eq $headingTxt) { $par.Range.Bold = $true }
    elseif ($t.StartsWith($subEn)) {
      $par.Range.Bold = $false
      $subRange = $doc.Range($par.Range.Start, $par.Range.Start + $subEn.Length)
      $subRange.Bold = $true
    }
    elseif ($t.StartsWith("Buttons:")) { $par.Range.Bold = $true }
  }

  $doc.Save()
  Write-Output "SAVED"
} finally {
  $doc.Close($false)
  $w.Quit()
}

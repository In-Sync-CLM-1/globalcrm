$ErrorActionPreference = 'Continue'
$cr = [char]13

$src = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx"
$bak = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx.bak"
if (-not (Test-Path $bak)) { Copy-Item -Force $src $bak; Write-Host "Backup created" }

$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$doc = $w.Documents.Open($src)
Write-Host ("Opened. Paragraphs=" + $doc.Paragraphs.Count + " Tables=" + $doc.Tables.Count)

function Replace-ParaText {
  param($paragraph, [string]$newText)
  $rng = $paragraph.Range
  # Keep the trailing paragraph mark; set inner text
  $endChar = $rng.End - 1  # exclude the paragraph mark
  $innerRange = $doc.Range($rng.Start, $endChar)
  $innerRange.Text = $newText
}

try {
  # ===== ENGLISH SIDE =====
  # T23 is "Send WhatsApp - After certificate" body box. Heading/subheading sit
  # before it as plain paragraphs. We clone heading-through-T23 then edit text.

  $enHeadPara = $doc.Paragraphs.Item(380)
  $enSubPara  = $doc.Paragraphs.Item(381)
  $enT23      = $doc.Tables.Item(23)

  # Paragraph 380 starts where it does; range to clone = enHeadPara.Range.Start
  # through enT23.Range.End (everything = heading + subheading + body table).
  $srcStart = $enHeadPara.Range.Start
  $srcEnd   = $enT23.Range.End
  Write-Host "English src range: $srcStart - $srcEnd (size=$($srcEnd - $srcStart))"

  $srcRange = $doc.Range($srcStart, $srcEnd)
  $srcRange.Copy()

  # Paste right after T23 ends
  $pastePoint = $doc.Range($srcEnd, $srcEnd)
  $pastePoint.Paste()
  Write-Host "Pasted English clone."

  # The pasted block sits AFTER T23. Its heading is now the SECOND occurrence
  # of "Send WhatsApp - After certificate" in the doc. Walk paragraphs from the
  # offset after the original T23.End forward, find the new heading.
  $afterOrigEnd = $srcEnd
  $newEnHeadingPara = $null
  for ($p = 1; $p -le $doc.Paragraphs.Count; $p++) {
    $par = $doc.Paragraphs.Item($p)
    if ($par.Range.Start -lt $afterOrigEnd) { continue }
    if ($par.Range.Tables.Count -gt 0) { continue }
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    if ($t -eq "Send WhatsApp - After certificate") { $newEnHeadingPara = $par; $newEnHeadingIdx = $p; break }
  }
  if (-not $newEnHeadingPara) { throw "Could not locate pasted English heading" }
  Write-Host ("New English heading at paragraph idx " + $newEnHeadingIdx)

  # The next paragraph (subheading) and then the table follow.
  $newEnSubPara = $doc.Paragraphs.Item($newEnHeadingIdx + 1)
  # The new body table is the 1×1 table whose Range starts AT-OR-AFTER the new
  # subheading END and whose first paragraph starts with "प्रिय प्रतिभाग" (body
  # text), not the next section's "8.  Statuses" header table.
  $newEnTbl = $null
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Range.Start -ge $newEnSubPara.Range.End -and $tt.Rows.Count -eq 1 -and $tt.Columns.Count -eq 1) {
      $firstP = $tt.Range.Paragraphs.Item(1).Range.Text.TrimEnd($cr, [char]7)
      if ($firstP.StartsWith("प्रिय प्रतिभाग")) { $newEnTbl = $tt; break }
    }
  }
  if (-not $newEnTbl) { throw "Could not locate new English body table" }
  Write-Host ("New English body table range " + $newEnTbl.Range.Start + " - " + $newEnTbl.Range.End)

  # ----- Replace English text -----
  Replace-ParaText $newEnHeadingPara "Send WhatsApp - Short Attendance"
  Replace-ParaText $newEnSubPara "When to use it: When a beneficiary's training attendance/progress is low or NIL — warns that the training is mandatory and loan disbursement may be affected if not completed."

  # Replace the entire body-table text. We rebuild paragraphs within the cell.
  $cell = $newEnTbl.Cell(1, 1)
  $bodyText = "प्रिय प्रतिभागी," + $cr + `
"यह देखा गया है कि आपकी CM YUVA EDP ट्रेनिंग की अटेंडेंस/प्रगति वर्तमान में कम या NIL है। कृपया नियमित रूप से पोर्टल पर लॉगिन कर अपनी अनिवार्य (Mandatory) ट्रेनिंग पूर्ण करें।" + $cr + `
"" + $cr + `
"कृपया ध्यान दें कि CM YUVA EDP ट्रेनिंग अनिवार्य है। ट्रेनिंग पूर्ण न होने की स्थिति में आपके लोन डिस्बर्समेंट की प्रक्रिया प्रभावित हो सकती है।" + $cr + `
"" + $cr + `
"कृपया नीचे दिए गए 'लॉगिन करें' बटन पर क्लिक करके लॉगिन कीजिए।" + $cr + `
"" + $cr + `
"धन्यवाद," + $cr + `
"उद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ" + $cr + `
"Buttons:  [ लॉगिन करें (Login) ]  "

  # cell.Range includes a trailing end-of-cell marker (char 7). Replace inner text.
  $cellRng = $cell.Range
  $innerEnd = $cellRng.End - 1
  $innerRange = $doc.Range($cellRng.Start, $innerEnd)
  $innerRange.Text = $bodyText
  Write-Host "English body cell text replaced."

  # ===== HINDI SIDE =====
  # Hindi mirror: heading at para that originally was 782, subheading at 783,
  # body table is the table right after (originally T51 area). Find by content.

  Write-Host "Locating Hindi anchors..."
  # After English replace: original English detail (heading still says 'After certificate')
  # is the 1st non-table occurrence; Hindi detail is the 2nd. The pasted English
  # block's heading was already renamed to 'Send WhatsApp - Short Attendance'.
  $hiHeadingPara = $null
  $hiHeadingIdx = -1
  $occ = 0
  $totalParas = $doc.Paragraphs.Count
  for ($p = 1; $p -le $totalParas; $p++) {
    $par = $doc.Paragraphs.Item($p)
    if ($par.Range.Tables.Count -gt 0) { continue }
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    if ($t -eq "Send WhatsApp - After certificate") {
      $occ++
      if ($occ -eq 2) { $hiHeadingPara = $par; $hiHeadingIdx = $p; break }
    }
  }
  if (-not $hiHeadingPara) { throw "Hindi heading not found (occurrences seen: $occ)" }
  Write-Host ("Hindi heading at paragraph idx " + $hiHeadingIdx)

  $hiSubPara = $doc.Paragraphs.Item($hiHeadingIdx + 1)
  Write-Host ("DEBUG: Hindi heading Range.End=" + $hiHeadingPara.Range.End)
  Write-Host ("DEBUG: Hindi sub Range start=" + $hiSubPara.Range.Start + " end=" + $hiSubPara.Range.End)
  $hiTbl = $null
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Rows.Count -eq 1 -and $tt.Columns.Count -eq 1 -and $tt.Range.Start -ge $hiSubPara.Range.Start) {
      $firstP = $tt.Range.Paragraphs.Item(1).Range.Text.TrimEnd($cr, [char]7)
      $preview = $firstP.Substring(0, [Math]::Min(30, $firstP.Length))
      Write-Host ("DEBUG: 1x1 T$t start=$($tt.Range.Start) end=$($tt.Range.End) first='$preview'")
      if ($firstP.StartsWith("प्रिय प्रतिभाग")) { $hiTbl = $tt; break }
    }
  }
  if (-not $hiTbl) { throw "Hindi body table not found" }

  $hiSrcStart = $hiHeadingPara.Range.Start
  $hiSrcEnd = $hiTbl.Range.End
  Write-Host "Hindi src range: $hiSrcStart - $hiSrcEnd"

  $hiSrcRange = $doc.Range($hiSrcStart, $hiSrcEnd)
  $hiSrcRange.Copy()
  $hiPastePoint = $doc.Range($hiSrcEnd, $hiSrcEnd)
  $hiPastePoint.Paste()
  Write-Host "Pasted Hindi clone."

  # Find the new pasted Hindi heading
  $newHiHeadingPara = $null
  for ($p = 1; $p -le $doc.Paragraphs.Count; $p++) {
    $par = $doc.Paragraphs.Item($p)
    if ($par.Range.Start -lt $hiSrcEnd) { continue }
    if ($par.Range.Tables.Count -gt 0) { continue }
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    if ($t -eq "Send WhatsApp - After certificate") { $newHiHeadingPara = $par; $newHiHeadingIdx = $p; break }
  }
  if (-not $newHiHeadingPara) { throw "New Hindi heading not found after paste" }
  Write-Host ("New Hindi heading at paragraph idx " + $newHiHeadingIdx)

  $newHiSubPara = $doc.Paragraphs.Item($newHiHeadingIdx + 1)
  $newHiTbl = $null
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Range.Start -ge $newHiSubPara.Range.End -and $tt.Rows.Count -eq 1 -and $tt.Columns.Count -eq 1) {
      $firstP = $tt.Range.Paragraphs.Item(1).Range.Text.TrimEnd($cr, [char]7)
      if ($firstP.StartsWith("प्रिय प्रतिभाग")) { $newHiTbl = $tt; break }
    }
  }
  if (-not $newHiTbl) { throw "New Hindi body table not found" }

  Replace-ParaText $newHiHeadingPara "Send WhatsApp - Short Attendance"
  Replace-ParaText $newHiSubPara "कब उपयोग करें: जब प्रशिक्षण की अटेंडेंस/प्रगति कम या शून्य हो — चेतावनी देता है कि प्रशिक्षण अनिवार्य है, अन्यथा लोन डिस्बर्समेंट प्रभावित हो सकता है।"

  $hiCell = $newHiTbl.Cell(1, 1)
  $hiBodyText = "प्रिय प्रतिभागी," + $cr + `
"यह देखा गया है कि आपकी CM YUVA EDP ट्रेनिंग की अटेंडेंस/प्रगति वर्तमान में कम या NIL है। कृपया नियमित रूप से पोर्टल पर लॉगिन कर अपनी अनिवार्य (Mandatory) ट्रेनिंग पूर्ण करें।" + $cr + `
"" + $cr + `
"कृपया ध्यान दें कि CM YUVA EDP ट्रेनिंग अनिवार्य है। ट्रेनिंग पूर्ण न होने की स्थिति में आपके लोन डिस्बर्समेंट की प्रक्रिया प्रभावित हो सकती है।" + $cr + `
"" + $cr + `
"कृपया नीचे दिए गए 'लॉगिन करें' बटन पर क्लिक करके लॉगिन कीजिए।" + $cr + `
"" + $cr + `
"धन्यवाद," + $cr + `
"उद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ" + $cr + `
"बटन:  [ लॉगिन करें (Login) ]  "

  $hiCellRng = $hiCell.Range
  $hiInner = $doc.Range($hiCellRng.Start, $hiCellRng.End - 1)
  $hiInner.Text = $hiBodyText
  Write-Host "Hindi body cell text replaced."

  # ===== TABLE ROWS (add LAST so table indexes don't drift while we cloned) =====
  Write-Host "Adding Hindi mapping table row..."
  # Re-find the Hindi mapping table: it's the only 2-column 7-row (now 8-row) table in the Hindi half.
  # Easiest: walk tables, find first 7-row x 2-col table where first cell text starts with "आप जो एक्शन"
  $hiMap = $null
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Columns.Count -eq 2 -and $tt.Rows.Count -ge 7) {
      $firstCell = $tt.Cell(1,1).Range.Text.TrimEnd($cr, [char]7)
      if ($firstCell.StartsWith("आप जो एक्शन")) { $hiMap = $tt; break }
    }
  }
  if (-not $hiMap) { throw "Hindi mapping table not found" }
  $newRowHi = $hiMap.Rows.Add()
  $newRowHi.Cells.Item(1).Range.Text = "Send WhatsApp - Short Attendance"
  $newRowHi.Cells.Item(2).Range.Text = "कम/NIL उपस्थिति की चेतावनी, लॉगिन लिंक के साथ"
  Write-Host "  Hindi mapping row OK"

  Write-Host "Adding English mapping table row..."
  $enMap = $null
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Columns.Count -eq 2 -and $tt.Rows.Count -ge 7) {
      $firstCell = $tt.Cell(1,1).Range.Text.TrimEnd($cr, [char]7)
      if ($firstCell -eq "Action you set") { $enMap = $tt; break }
    }
  }
  if (-not $enMap) { throw "English mapping table not found" }
  $newRowEn = $enMap.Rows.Add()
  $newRowEn.Cells.Item(1).Range.Text = "Send WhatsApp - Short Attendance"
  $newRowEn.Cells.Item(2).Range.Text = "Low/NIL attendance reminder with login link"
  Write-Host "  English mapping row OK"

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

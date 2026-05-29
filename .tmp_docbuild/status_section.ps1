$ErrorActionPreference = 'Continue'
$cr = [char]13
$src = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx"
$bak = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx.bak2"
if (-not (Test-Path $bak)) { Copy-Item -Force $src $bak; Write-Host "Backup saved as $bak" }

$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$doc = $w.Documents.Open($src)
Write-Host ("Opened. Paragraphs=" + $doc.Paragraphs.Count + " Tables=" + $doc.Tables.Count)

try {
  # Find the English Status table (Section 8). It is the 1x1 header table
  # whose first paragraph is "8.  Statuses You'll See" and the SIBLING 5-row
  # 2-col table right after it. We need to:
  #   1. Rename the section header to "Status & Disposition"
  #   2. Rewrite the 5-row dispositions table to be a 3-row Status table:
  #        Pending / Done / Failed
  #   3. Insert a NEW 6-row Disposition table after the Status table.
  # Then do the Hindi mirror.

  # Strategy: edit text in the existing 5-row table to become the 3-row Status
  # (delete 2 rows, rewrite remaining contents). Then clone the same table and
  # populate it with 6 rows for Disposition (one row at a time via Rows.Add).

  function Edit-StatusTable($statusTbl, $newRows) {
    # newRows is an array of @($label, $meaning) pairs.
    # Current row 1 is header. Keep header. Adjust rows 2..N.
    # If we have fewer rows than current, delete extras. If more, add.
    $headerRows = 1
    $currentDataRows = $statusTbl.Rows.Count - $headerRows
    $desiredDataRows = $newRows.Count
    # Reduce excess
    while ($statusTbl.Rows.Count -gt ($headerRows + $desiredDataRows)) {
      $statusTbl.Rows.Item($statusTbl.Rows.Count).Delete()
    }
    # Add deficit
    while ($statusTbl.Rows.Count -lt ($headerRows + $desiredDataRows)) {
      $statusTbl.Rows.Add() | Out-Null
    }
    for ($i = 0; $i -lt $newRows.Count; $i++) {
      $r = $statusTbl.Rows.Item($headerRows + 1 + $i)
      $r.Cells.Item(1).Range.Text = $newRows[$i][0]
      $r.Cells.Item(2).Range.Text = $newRows[$i][1]
    }
  }

  # ---------- English ----------
  # The English Statuses-You'll-See section header table is found by content.
  $enHeaderTbl = $null
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Rows.Count -eq 1 -and $tt.Columns.Count -eq 1) {
      $p1 = $tt.Range.Paragraphs.Item(1).Range.Text.TrimEnd($cr,[char]7)
      if ($p1 -match "^8\..*Statuses You.ll See$") { $enHeaderTbl = $tt; $enHeaderIdx = $t; break }
    }
  }
  if (-not $enHeaderTbl) { throw "English Section 8 header not found" }
  Write-Host "English section header at table index $enHeaderIdx"

  # Rename the header
  $hdrRange = $enHeaderTbl.Range.Paragraphs.Item(1).Range
  $hdrInner = $doc.Range($hdrRange.Start, $hdrRange.End - 1)
  $hdrInner.Text = "8.  Status & Disposition"

  # The Status (originally dispositions) table is the NEXT 2-column table.
  $enStatusTbl = $null
  for ($t = $enHeaderIdx + 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Columns.Count -eq 2 -and $tt.Range.Start -gt $enHeaderTbl.Range.End) {
      $enStatusTbl = $tt; $enStatusIdx = $t; break
    }
  }
  if (-not $enStatusTbl) { throw "English status detail table not found" }
  Write-Host "English status detail table at index $enStatusIdx, rows=$($enStatusTbl.Rows.Count)"

  # Replace its content with the 3-value Status table.
  # Row1 is the header — set explicitly to "Status / Meaning" (it already is).
  $enStatusTbl.Cell(1,1).Range.Text = "Status"
  $enStatusTbl.Cell(1,2).Range.Text = "Meaning"
  Edit-StatusTable $enStatusTbl @(
    @("Pending", "The action has not yet been carried out. The system will still try."),
    @("Done", "The action was carried out: the WhatsApp template was sent (or delivered/opened), or the AI voice call connected with the beneficiary."),
    @("Failed", "The action will not succeed: the WhatsApp template was rejected by the carrier (e.g. the number isn't on WhatsApp), or the contact is marked 'do not call', or three calls were attempted without connecting.")
  )

  # Insert a Disposition table right after the Status table.
  # Word: build a new table at the position right after the Status table.
  $afterPos = $enStatusTbl.Range.End
  $insertRange = $doc.Range($afterPos, $afterPos)
  $insertRange.InsertParagraphAfter()
  $newTableAnchor = $doc.Range($insertRange.End - 1, $insertRange.End - 1)
  $newDispTbl = $doc.Tables.Add($newTableAnchor, 6, 2)
  $newDispTbl.Borders.Enable = $true
  $newDispTbl.Cell(1,1).Range.Text = "Disposition"
  $newDispTbl.Cell(1,2).Range.Text = "Meaning"
  $dispRows = @(
    @("Call made", "The AI voice call was placed to this beneficiary."),
    @("Message Sent", "The WhatsApp message left our system towards the beneficiary."),
    @("Message Delivered", "The message reached the beneficiary's phone."),
    @("Message Opened", "The beneficiary opened and read the message."),
    @("Message Failed", "The carrier rejected delivery (most commonly because the number is not on WhatsApp).")
  )
  for ($i = 0; $i -lt $dispRows.Count; $i++) {
    $newDispTbl.Cell($i + 2, 1).Range.Text = $dispRows[$i][0]
    $newDispTbl.Cell($i + 2, 2).Range.Text = $dispRows[$i][1]
  }
  Write-Host "English Disposition table inserted at $afterPos"

  # ---------- Hindi ----------
  $hiHeaderTbl = $null
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Rows.Count -eq 1 -and $tt.Columns.Count -eq 1) {
      $p1 = $tt.Range.Paragraphs.Item(1).Range.Text.TrimEnd($cr,[char]7)
      if ($p1 -match "^8\..*स्थितियाँ जो आपको दिखेंगी$") { $hiHeaderTbl = $tt; $hiHeaderIdx = $t; break }
    }
  }
  if (-not $hiHeaderTbl) { throw "Hindi Section 8 header not found" }
  Write-Host "Hindi section header at table index $hiHeaderIdx"

  $hdrRange = $hiHeaderTbl.Range.Paragraphs.Item(1).Range
  $hdrInner = $doc.Range($hdrRange.Start, $hdrRange.End - 1)
  $hdrInner.Text = "8.  स्थिति एवं डिस्पोज़िशन"

  $hiStatusTbl = $null
  for ($t = $hiHeaderIdx + 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Columns.Count -eq 2 -and $tt.Range.Start -gt $hiHeaderTbl.Range.End) {
      $hiStatusTbl = $tt; $hiStatusIdx = $t; break
    }
  }
  if (-not $hiStatusTbl) { throw "Hindi status detail table not found" }
  Write-Host "Hindi status detail table at index $hiStatusIdx, rows=$($hiStatusTbl.Rows.Count)"

  $hiStatusTbl.Cell(1,1).Range.Text = "स्थिति (Status)"
  $hiStatusTbl.Cell(1,2).Range.Text = "अर्थ"
  Edit-StatusTable $hiStatusTbl @(
    @("Pending (लंबित)", "एक्शन अभी तक नहीं हुआ है। सिस्टम बाद में दोबारा प्रयास करेगा।"),
    @("Done (पूर्ण)", "एक्शन पूरा हो गया: व्हाट्सएप टेम्प्लेट भेजा/डिलीवर/खोला गया, या AI वॉइस कॉल लाभार्थी से जुड़ी।"),
    @("Failed (विफल)", "एक्शन सफल नहीं होगा: कैरियर ने व्हाट्सएप टेम्प्लेट अस्वीकार कर दिया (उदा. नंबर व्हाट्सएप पर नहीं है), या 'Do not call' सेट है, या तीन बार कॉल करने पर भी कनेक्ट नहीं हुआ।")
  )

  $afterPos = $hiStatusTbl.Range.End
  $insertRange = $doc.Range($afterPos, $afterPos)
  $insertRange.InsertParagraphAfter()
  $newTableAnchor = $doc.Range($insertRange.End - 1, $insertRange.End - 1)
  $newDispTblHi = $doc.Tables.Add($newTableAnchor, 6, 2)
  $newDispTblHi.Borders.Enable = $true
  $newDispTblHi.Cell(1,1).Range.Text = "डिस्पोज़िशन (Disposition)"
  $newDispTblHi.Cell(1,2).Range.Text = "अर्थ"
  $dispRowsHi = @(
    @("कॉल किया गया (Call made)", "इस लाभार्थी को AI वॉइस कॉल की गई।"),
    @("संदेश भेजा गया (Message Sent)", "व्हाट्सएप संदेश हमारी प्रणाली से लाभार्थी की ओर निकल गया।"),
    @("संदेश डिलीवर हुआ (Message Delivered)", "संदेश लाभार्थी के फोन तक पहुँच गया।"),
    @("संदेश खोला गया (Message Opened)", "लाभार्थी ने संदेश खोलकर पढ़ा।"),
    @("संदेश विफल (Message Failed)", "कैरियर ने डिलीवरी अस्वीकार कर दी (आमतौर पर क्योंकि नंबर व्हाट्सएप पर नहीं है)।")
  )
  for ($i = 0; $i -lt $dispRowsHi.Count; $i++) {
    $newDispTblHi.Cell($i + 2, 1).Range.Text = $dispRowsHi[$i][0]
    $newDispTblHi.Cell($i + 2, 2).Range.Text = $dispRowsHi[$i][1]
  }
  Write-Host "Hindi Disposition table inserted at $afterPos"

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

$ErrorActionPreference = 'Continue'
$cr = [char]13
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$doc = $w.Documents.Open("C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx")
try {
  foreach ($needle in @("Status & Disposition", "स्थिति एवं")) {
    $found = $false
    for ($t = 1; $t -le $doc.Tables.Count; $t++) {
      if ($found) { break }
      $tt = $doc.Tables.Item($t)
      if ($tt.Rows.Count -eq 1 -and $tt.Columns.Count -eq 1) {
        $p1 = $tt.Range.Paragraphs.Item(1).Range.Text.TrimEnd($cr, [char]7)
        if ($p1.IndexOf($needle) -ge 0) {
          # Locate the 10-row Status+Disposition table.
          for ($n = $t + 1; $n -le $doc.Tables.Count; $n++) {
            $tn = $doc.Tables.Item($n)
            if ($tn.Columns.Count -eq 2 -and $tn.Rows.Count -ge 10) {
              Write-Host ("Combined table T" + $n + " rows=" + $tn.Rows.Count)
              foreach ($r in @(1, 5)) {
                # iterate columns 1..2
                for ($cc = 1; $cc -le 2; $cc++) {
                  try {
                    $cell = $tn.Cell($r, $cc)
                    $cell.Range.Bold = $true
                    try { $cell.Shading.BackgroundPatternColor = 14869218 } catch {}
                  } catch {
                    Write-Host ("  cell ($r,$cc) failed: " + $_.Exception.Message)
                  }
                }
              }
              $found = $true
              break
            }
          }
        }
      }
    }
  }
  $doc.Save()
  Write-Host "DONE"
} finally {
  $doc.Close($false)
  $w.Quit()
}

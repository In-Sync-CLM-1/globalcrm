$ErrorActionPreference = 'Continue'
$cr = [char]13
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$doc = $w.Documents.Open("C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx")
try {
  foreach ($needle in @("Status & Disposition", "स्थिति एवं")) {
    for ($t = 1; $t -le $doc.Tables.Count; $t++) {
      $tt = $doc.Tables.Item($t)
      if ($tt.Rows.Count -eq 1 -and $tt.Columns.Count -eq 1) {
        $p1 = $tt.Range.Paragraphs.Item(1).Range.Text.TrimEnd($cr, [char]7)
        if ($p1.IndexOf($needle) -ge 0) {
          # Find the next 2-col table (the merged Status+Disposition one) and bold rows 1 and 5
          $n = $t + 1
          while ($n -le $doc.Tables.Count) {
            $tn = $doc.Tables.Item($n)
            if ($tn.Columns.Count -ne 2) { break }
            if ($tn.Rows.Count -ge 5) {
              # Bold header (row 1) - it likely already is bold; ensure
              foreach ($r in @(1, 5)) {
                try {
                  $row = $tn.Rows.Item($r)
                  for ($cc = 1; $cc -le $row.Cells.Count; $cc++) {
                    $row.Cells.Item($cc).Range.Bold = $true
                    try { $row.Cells.Item($cc).Shading.BackgroundPatternColor = 14869218 } catch {}
                  }
                } catch {
                  Write-Host ("  skip row $r in T$($n): " + $_.Exception.Message)
                }
              }
            }
            break
          }
          break
        }
      }
    }
  }
  $doc.Save()
  Write-Host "BOLDED"
} catch {
  Write-Host ("ERROR: " + $_.Exception.Message)
} finally {
  $doc.Close($false)
  $w.Quit()
}

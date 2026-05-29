$w = New-Object -ComObject Word.Application
$w.Visible = $false
$doc = $w.Documents.Open("C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx", [Type]::Missing, $true)
$cr = [char]13
foreach ($needle in @("Status & Disposition", "स्थिति एवं")) {
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $tt = $doc.Tables.Item($t)
    if ($tt.Rows.Count -eq 1 -and $tt.Columns.Count -eq 1) {
      $p1 = $tt.Range.Paragraphs.Item(1).Range.Text.TrimEnd($cr, [char]7)
      if ($p1.IndexOf($needle) -ge 0) {
        Write-Host ("=== Section header T" + $t + ": " + $p1 + " ===")
        $n = $t + 1
        while ($n -le $doc.Tables.Count) {
          $tn = $doc.Tables.Item($n)
          if ($tn.Columns.Count -ne 2) { break }
          Write-Host ("  --- T" + $n + " rows=" + $tn.Rows.Count + " ---")
          for ($r = 1; $r -le $tn.Rows.Count; $r++) {
            $c1 = $tn.Cell($r, 1).Range.Text.TrimEnd($cr, [char]7)
            $c2 = $tn.Cell($r, 2).Range.Text.TrimEnd($cr, [char]7)
            Write-Host ("    R" + $r + " | " + $c1 + " | " + $c2)
          }
          $n++
        }
        break
      }
    }
  }
}
$doc.Close($false)
$w.Quit()

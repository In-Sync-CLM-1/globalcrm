$src = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx"
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$doc = $w.Documents.Open($src, [Type]::Missing, $true)
$cr = [char]13
foreach ($t in 17..28) {
  $tbl = $doc.Tables.Item($t)
  Write-Host "==== T$t rows=$($tbl.Rows.Count) cols=$($tbl.Columns.Count) start=$($tbl.Range.Start) end=$($tbl.Range.End) ===="
  $paras = $tbl.Range.Paragraphs.Count
  for ($i = 1; $i -le [Math]::Min(3, $paras); $i++) {
    $tx = $tbl.Range.Paragraphs.Item($i).Range.Text.TrimEnd($cr, [char]7)
    $sz = $tx.Length
    Write-Host ("  para$i (len=$sz): " + $tx.Substring(0, [Math]::Min(80, $sz)))
  }
  if ($paras -gt 3) {
    $last = $tbl.Range.Paragraphs.Item($paras).Range.Text.TrimEnd($cr, [char]7)
    Write-Host ("  ...lastP (len=$($last.Length)): " + $last.Substring(0, [Math]::Min(60, $last.Length)))
  }
}
$doc.Close($false)
$w.Quit()

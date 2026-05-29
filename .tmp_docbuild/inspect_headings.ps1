$src = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx"
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$doc = $w.Documents.Open($src, [Type]::Missing, $true)
$cr = [char]13
foreach ($p in @(379, 380, 381, 382, 391, 392, 393, 781, 782, 783, 784, 793, 794, 795)) {
  $par = $doc.Paragraphs.Item($p)
  $t = $par.Range.Text.TrimEnd($cr, [char]7)
  $inTbl = $par.Range.Tables.Count
  $startOff = $par.Range.Start
  $endOff = $par.Range.End
  Write-Host ("[" + $p + "|tbl=" + $inTbl + "|range=" + $startOff + "-" + $endOff + "] " + ($t.Substring(0, [Math]::Min(80, $t.Length))))
}
$doc.Close($false)
$w.Quit()

$ErrorActionPreference = 'Continue'
$cr = [char]13
$src = "C:\Users\Admin\Downloads\IEDUP_CM_YUVA_System_User_Guide.docx"
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$doc = $w.Documents.Open($src, [Type]::Missing, $true)
try {
  for ($p = 388; $p -le 395; $p++) {
    $par = $doc.Paragraphs.Item($p)
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    $inTbl = $par.Range.Tables.Count
    $startsB = $t.StartsWith("Buttons:")
    Write-Host ("[" + $p + "|tbl=" + $inTbl + "|startsB=" + $startsB + "|len=" + $t.Length + "] " + $t)
    # Print first 30 char codes
    $codes = @()
    for ($i = 0; $i -lt [Math]::Min(20, $t.Length); $i++) { $codes += [int]$t[$i] }
    Write-Host ("  codes: " + ($codes -join ","))
  }
  for ($p = 790; $p -le 796; $p++) {
    $par = $doc.Paragraphs.Item($p)
    $t = $par.Range.Text.TrimEnd($cr, [char]7)
    $inTbl = $par.Range.Tables.Count
    $startsHi = $t.StartsWith("बटन:")
    Write-Host ("[" + $p + "|tbl=" + $inTbl + "|startsHi=" + $startsHi + "|len=" + $t.Length + "] " + $t)
    $codes = @()
    for ($i = 0; $i -lt [Math]::Min(10, $t.Length); $i++) { $codes += [int]$t[$i] }
    Write-Host ("  codes: " + ($codes -join ","))
  }
} finally {
  $doc.Close($false)
  $w.Quit()
}

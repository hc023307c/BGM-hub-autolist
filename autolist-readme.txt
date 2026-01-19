1.之後再audio加新音檔 資料夾名稱 就是群組名、  資料夾內音檔名稱就是 按鍵名(不含副檔名)


2.在網頁根目錄按右鍵開「在終端機中開啟」powershell

3.輸入
$root = (Get-Item .).FullName
(Get-ChildItem audio -Recurse -File).FullName.Replace("$root\", "") |
Out-File audio/audio_list.txt -Encoding utf8

產生會在audio資料夾內產生audio_list.txt

4.上git push上GitHub 上執行CI/CD
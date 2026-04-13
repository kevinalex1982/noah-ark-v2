import zipfile
import xml.etree.ElementTree as ET
import os
import sys

# 设置 UTF-8 输出
sys.stdout.reconfigure(encoding='utf-8')

# 切换到文档目录
os.chdir(r"C:\Users\Administrator\.openclaw\workspace\docs\对接协议及需求")

# 找到虹膜 VN 文档
files = os.listdir('.')
iris_doc = [f for f in files if '虹膜' in f and f.endswith('.docx')]
print(f"找到虹膜文档：{iris_doc}")

if iris_doc:
    doc_path = iris_doc[0]
    # 读取 docx 中的 document.xml
    with zipfile.ZipFile(doc_path, 'r') as zip_ref:
        content = zip_ref.read('word/document.xml').decode('utf-8', errors='ignore')
        # 简单提取文本
        root = ET.fromstring(content)
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        texts = []
        for para in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
            if para.text:
                texts.append(para.text)
        
        # 写入文件
        with open('iris_protocol.txt', 'w', encoding='utf-8') as f:
            f.write('\n'.join(texts))
        print("已写入 iris_protocol.txt")

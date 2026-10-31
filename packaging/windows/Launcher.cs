using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;

public sealed class Launcher : Form {
 readonly string root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
 readonly string home;
 readonly string engineRoot;
 readonly JavaScriptSerializer json=new JavaScriptSerializer();
 readonly TextBox api=new TextBox(), model=new TextBox(), endpoint=new TextBox(), log=new TextBox();
 readonly ComboBox provider=new ComboBox();
 readonly CheckBox voice=new CheckBox();
 readonly Label state=new Label();
 readonly List<Button> actions=new List<Button>();
 readonly ProgressBar progress=new ProgressBar();
 bool busy=false;
 public Launcher(string[] args) {
  home=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Feiyu-Life");
  foreach(string arg in args)if(arg.StartsWith("--home="))home=Path.GetFullPath(arg.Substring(7));
  engineRoot=root;foreach(string arg in args)if(arg.StartsWith("--engine-root="))engineRoot=Path.GetFullPath(arg.Substring(14));
  Text="肥鱼 · 安装与生活入口"; Width=760; Height=790; MinimumSize=new Size(680,680); StartPosition=FormStartPosition.CenterScreen;
  BackColor=Color.FromArgb(244,248,246); Font=new Font("Microsoft YaHei UI",10); AutoScaleMode=AutoScaleMode.Dpi;
  var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(28),ColumnCount=2,RowCount=13};
  layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,116));layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); Controls.Add(layout);
  var title=new Label{Text="让肥鱼住下来。",Font=new Font(Font.FontFamily,23,FontStyle.Bold),ForeColor=Color.FromArgb(35,72,66),AutoSize=true,Margin=new Padding(0,0,0,12)};layout.Controls.Add(title,0,0);layout.SetColumnSpan(title,2);
  var intro=new Label{Text="运行环境已随包准备。首次填写模型 API，再到生活台登录需要的账号。",AutoSize=true,MaximumSize=new Size(640,0),Margin=new Padding(0,0,0,20)};layout.Controls.Add(intro,0,1);layout.SetColumnSpan(intro,2);
  provider.DropDownStyle=ComboBoxStyle.DropDownList;provider.Items.AddRange(new object[]{"DeepSeek 官方","自定义 OpenAI 兼容 API"});provider.SelectedIndex=0;provider.Dock=DockStyle.Fill;AddRow(layout,2,"模型服务",provider);
  api.UseSystemPasswordChar=true;api.Dock=DockStyle.Fill;AddRow(layout,3,"API Key",api);
  model.Text="deepseek-flash";model.Dock=DockStyle.Fill;AddRow(layout,4,"模型名称",model);
  endpoint.Text="https://api.example.com/v1";endpoint.Dock=DockStyle.Fill;endpoint.Enabled=false;AddRow(layout,5,"API 地址",endpoint);
  provider.SelectedIndexChanged+=(s,e)=>{endpoint.Enabled=provider.SelectedIndex==1;if(provider.SelectedIndex==1&&model.Text=="deepseek-flash")model.Text="";};
  voice.Text="启用 Ctrl+Alt+空格快捷语音与透明字幕";voice.Checked=true;voice.AutoSize=true;layout.Controls.Add(voice,1,6);
  state.Text="实例目录："+home;state.AutoSize=true;state.MaximumSize=new Size(640,0);state.Margin=new Padding(0,12,0,12);layout.Controls.Add(state,0,7);layout.SetColumnSpan(state,2);
  var buttons=new FlowLayoutPanel{Dock=DockStyle.Fill,AutoSize=true,WrapContents=true,Margin=new Padding(0,8,0,8)};
  ButtonOf(buttons,"安装并打开",async()=>{if(!File.Exists(Path.Combine(engineRoot,"release.json"))){MessageBox.Show(this,"请打开新安装包中的肥鱼.exe，或点击升级选择新包。","安装包位置");return;}if(string.IsNullOrWhiteSpace(api.Text)&&!File.Exists(Path.Combine(home,"active.json"))){MessageBox.Show(this,"请填写 API Key。也可以安装后在“模型与登录”中使用 DSH 支持的其他服务。","模型设置");return;}await Run("install",Config(),"--bundle="+engineRoot);await Run("open",null);});
  ButtonOf(buttons,"打开肥鱼",async()=>{await Run("open",null);});
  ButtonOf(buttons,"模型与登录",async()=>{await Run("models",null);});
  ButtonOf(buttons,"保存 API 设置",async()=>{await Run("configure",Config());await Run("open",null);});
  ButtonOf(buttons,"检查",async()=>{await Run("self-check",null);await Run("status",null);});
  ButtonOf(buttons,"升级",async()=>{using(var pick=new FolderBrowserDialog{Description="选择新版本解压后的文件夹（包含 release.json）"}){if(pick.ShowDialog(this)!=DialogResult.OK)return;await Run("upgrade",new Dictionary<string,object>(),"--bundle="+pick.SelectedPath);await Run("open",null);}});
  ButtonOf(buttons,"回退上一版",async()=>{if(MessageBox.Show(this,"将恢复升级前的记忆和设置。当前版本与数据会另存，随时可找回。继续吗？","回退",MessageBoxButtons.OKCancel,MessageBoxIcon.Question)!=DialogResult.OK)return;await Run("rollback",null);await Run("open",null);});
  ButtonOf(buttons,"停止本实例",async()=>{await Run("stop",null);});
  layout.Controls.Add(buttons,0,8);layout.SetColumnSpan(buttons,2);
  progress.Dock=DockStyle.Fill;progress.Height=8;progress.Style=ProgressBarStyle.Continuous;layout.Controls.Add(progress,0,9);layout.SetColumnSpan(progress,2);
  log.Multiline=true;log.ReadOnly=true;log.ScrollBars=ScrollBars.Vertical;log.Dock=DockStyle.Fill;log.BackColor=Color.White;log.BorderStyle=BorderStyle.FixedSingle;log.MinimumSize=new Size(200,180);layout.Controls.Add(log,0,10);layout.SetColumnSpan(log,2);layout.RowStyles.Add(new RowStyle());
  var note=new Label{Text="QQ 为可选连接，需登录已获许可的 OneBot11 网关；其他网站在生活台内登录。升级与回退只操作这个实例。",AutoSize=true,MaximumSize=new Size(640,0),ForeColor=Color.FromArgb(86,112,105),Margin=new Padding(0,14,0,0)};layout.Controls.Add(note,0,11);layout.SetColumnSpan(note,2);
  Shown+=async(s,e)=>{try{await Run("status",null);}catch(Exception ex){Append(ex.Message);}};
  FormClosing+=(s,e)=>{if(busy){e.Cancel=true;MessageBox.Show(this,"正在安装或恢复，请等待本次操作完成。","操作进行中");}};
 }
 void AddRow(TableLayoutPanel p,int row,string label,Control control){p.Controls.Add(new Label{Text=label,AutoSize=true,Margin=new Padding(0,7,8,12)},0,row);control.Margin=new Padding(0,3,0,10);p.Controls.Add(control,1,row);}
 void ButtonOf(FlowLayoutPanel p,string text,Func<Task> action){var b=new Button{Text=text,AutoSize=true,Padding=new Padding(10,5,10,5),FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(224,236,231),ForeColor=Color.FromArgb(32,69,62),Margin=new Padding(0,0,8,8)};b.Click+=async(s,e)=>{try{await action();}catch(Exception ex){Append(ex.Message);MessageBox.Show(this,ex.Message,"肥鱼",MessageBoxButtons.OK,MessageBoxIcon.Information);}};actions.Add(b);p.Controls.Add(b);}
 Dictionary<string,object> Config(){return new Dictionary<string,object>{{"apiKey",api.Text.Trim()},{"provider",provider.SelectedIndex==0?"deepseek":"custom"},{"baseURL",endpoint.Text.Trim()},{"model",model.Text.Trim()},{"voice",voice.Checked}};}
 void Append(string value){log.AppendText(DateTime.Now.ToString("HH:mm:ss")+"  "+value+Environment.NewLine);}
 static string Quote(string value){return "\""+value.Replace("\\\"","\\\\\"").Replace("\"","\\\"").TrimEnd('\\')+"\"";}
 async Task Run(string action,object input,string extra=null){
  if(busy)throw new Exception("另一个操作正在进行。");busy=true;foreach(var b in actions)b.Enabled=false;progress.Style=ProgressBarStyle.Marquee;
  try{
   string node=Path.Combine(engineRoot,"runtime","node-v24.19.0-win-x64","node.exe");if(!File.Exists(node))throw new Exception("安装包中的运行环境缺失，请完整解压后再打开。");
   string manager=Path.Combine(root,"manager.mjs");if(!File.Exists(manager))manager=Path.Combine(engineRoot,"manager.mjs");
   var start=new ProcessStartInfo(node,Quote(manager)+" "+action+" "+Quote("--home="+home)+(extra==null?"":" "+Quote(extra))){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8,WorkingDirectory=root};
   using(var process=new Process{StartInfo=start}){
    process.Start();var stderr=process.StandardError.ReadToEndAsync();
    bool needsInput=action=="install"||action=="upgrade"||action=="configure";
    if(needsInput)await process.StandardInput.WriteAsync(input==null?"{}":json.Serialize(input));
    // Status/open/stop do not consume stdin and may finish immediately. A
    // completed reader must not turn their valid JSON result into a pipe error.
    try{process.StandardInput.Close();}catch(IOException){if(needsInput)throw;}
    bool ok=false;string failure="操作失败，请检查安装包或使用修复入口。";string line;
    while((line=await process.StandardOutput.ReadLineAsync())!=null){Dictionary<string,object> item;try{item=json.Deserialize<Dictionary<string,object>>(line);}catch{continue;}
     if(item.ContainsKey("type")&&(string)item["type"]=="progress")Append(Convert.ToString(item["message"]));
     if(item.ContainsKey("type")&&(string)item["type"]=="result"){ok=Convert.ToBoolean(item["ok"]);if(!ok)failure=Convert.ToString(item["message"]);else if(item.ContainsKey("value")){var value=item["value"] as Dictionary<string,object>;if(value!=null){if(value.ContainsKey("installed")&&!Convert.ToBoolean(value["installed"]))Append("尚未安装。填写 API 后点击“安装并打开”。");else if(value.ContainsKey("version"))Append("版本 "+value["version"]+(value.ContainsKey("healthy")?Convert.ToBoolean(value["healthy"])?" · 运行正常":" · 当前未运行":" · 操作完成"));else Append("操作完成。");}}}
    }
    await Task.Run(()=>process.WaitForExit());await stderr;if(!ok||process.ExitCode!=0)throw new Exception(failure);
   }
   if(action=="install"||action=="upgrade"){api.Clear();CreateShortcuts();}
  }finally{busy=false;foreach(var b in actions)b.Enabled=true;progress.Style=ProgressBarStyle.Continuous;}
 }
 void CreateShortcuts(){try{
  string target=Path.Combine(home,"launcher","肥鱼.exe");if(!File.Exists(target))return;
  string instanceKey;using(var hash=System.Security.Cryptography.SHA256.Create())instanceKey=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(home))).Replace("-","").Substring(0,12).ToLowerInvariant();
  foreach(string dir in new[]{Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Environment.GetFolderPath(Environment.SpecialFolder.Programs)}){
   string shortcut=Path.Combine(dir,"肥鱼（一键版）.lnk");
   if(File.Exists(shortcut)&&!string.Equals(NativeShortcuts.ReadTarget(shortcut),target,StringComparison.OrdinalIgnoreCase)){
    shortcut=Path.Combine(dir,"肥鱼（一键版-"+instanceKey+"）.lnk");
    if(File.Exists(shortcut)&&!string.Equals(NativeShortcuts.ReadTarget(shortcut),target,StringComparison.OrdinalIgnoreCase))throw new IOException("已有不同实例的快捷方式，未覆盖。");
   }
   NativeShortcuts.Write(shortcut,target,Quote("--home="+home),Path.GetDirectoryName(target));
  }
 }catch{Append("已安装。可从实例目录的 launcher\\肥鱼.exe 打开。");}}
 [STAThread]static void Main(string[] args){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new Launcher(args));}
}

// Explicit wide-character shell APIs preserve Chinese paths on English Windows.
public static class NativeShortcuts {
 public static void Write(string file,string target,string arguments,string workingDirectory){Directory.CreateDirectory(Path.GetDirectoryName(file));object obj=new ShellLinkObject();try{var link=(IShellLinkW)obj;link.SetPath(target);link.SetArguments(arguments);link.SetWorkingDirectory(workingDirectory);((System.Runtime.InteropServices.ComTypes.IPersistFile)obj).Save(file,true);}finally{Marshal.FinalReleaseComObject(obj);}}
 public static string ReadTarget(string file){return Read(file,false);}
 public static string ReadArguments(string file){return Read(file,true);}
 static string Read(string file,bool arguments){object obj=new ShellLinkObject();try{((System.Runtime.InteropServices.ComTypes.IPersistFile)obj).Load(file,0);var text=new StringBuilder(32768);if(arguments)((IShellLinkW)obj).GetArguments(text,text.Capacity);else ((IShellLinkW)obj).GetPath(text,text.Capacity,IntPtr.Zero,4);return text.ToString();}finally{Marshal.FinalReleaseComObject(obj);}}
 [ComImport,Guid("00021401-0000-0000-C000-000000000046")]class ShellLinkObject{}
 [ComImport,InterfaceType(ComInterfaceType.InterfaceIsIUnknown),Guid("000214F9-0000-0000-C000-000000000046")]
 interface IShellLinkW {
  void GetPath([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder path,int count,IntPtr findData,uint flags);
  void GetIDList(out IntPtr idList);void SetIDList(IntPtr idList);
  void GetDescription([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int count);void SetDescription([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetWorkingDirectory([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int count);void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetArguments([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int count);void SetArguments([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetHotkey(out short key);void SetHotkey(short key);void GetShowCmd(out int command);void SetShowCmd(int command);
  void GetIconLocation([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder path,int count,out int index);void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)]string path,int index);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)]string path,uint reserved);void Resolve(IntPtr window,uint flags);void SetPath([MarshalAs(UnmanagedType.LPWStr)]string path);
 }
}

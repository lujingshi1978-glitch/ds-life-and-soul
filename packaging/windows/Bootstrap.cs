using System;using System.IO;using System.Diagnostics;using System.Windows.Forms;using System.Web.Script.Serialization;using System.Collections.Generic;using System.Text.RegularExpressions;
public static class Bootstrap {
 static string Quote(string s){return "\""+s.Replace("\"","\\\"").TrimEnd('\\')+"\"";}
 [STAThread]public static void Main(string[] args){try{string root=AppDomain.CurrentDomain.BaseDirectory;string gui;
  if(File.Exists(Path.Combine(root,"release.json")))gui=Path.Combine(root,"ui","Feiyu.UI.exe");
  else {string active=Path.Combine(root,"..","active.json");var value=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(active));string id=Convert.ToString(value["controller"]);if(!Regex.IsMatch(id,"^[a-f0-9]{64}$"))throw new Exception("安装记录缺少有效入口，请从完整安装包修复。");gui=Path.Combine(root,"controllers",id,"Feiyu.UI.exe");}
  if(!File.Exists(gui))throw new Exception("入口文件缺失，请完整解压安装包或重新安装修复。");string command=Quote("--engine-root="+root.TrimEnd(Path.DirectorySeparatorChar));foreach(string arg in args)command+=" "+Quote(arg);
  Process.Start(new ProcessStartInfo(gui,command){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(gui)});
 }catch(Exception e){MessageBox.Show(e.Message,"肥鱼入口",MessageBoxButtons.OK,MessageBoxIcon.Information);}}
}

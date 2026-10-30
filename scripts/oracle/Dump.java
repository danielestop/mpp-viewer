// Dev oracle (docs/decisions/0004): reads a .mpp with the original MPXJ and writes expected values as JSON.
// Usage: java -cp "<mpxj.jar>;<lib/*>" Dump.java <input.mpp> <output.json>
// Runs on the dev machine only; not part of the distributed file.

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.apache.poi.poifs.filesystem.POIFSFileSystem;
import org.mpxj.AssignmentField;
import org.mpxj.CustomField;
import org.mpxj.Duration;
import org.mpxj.FieldContainer;
import org.mpxj.FieldType;
import org.mpxj.ProjectFile;
import org.mpxj.ProjectProperties;
import org.mpxj.Rate;
import org.mpxj.Relation;
import org.mpxj.Resource;
import org.mpxj.ResourceAssignment;
import org.mpxj.ResourceField;
import org.mpxj.Task;
import org.mpxj.TaskField;
import org.mpxj.FieldTypeClass;
import org.mpxj.UserDefinedField;
import org.mpxj.mpp.MPPReader;

import java.io.File;
import java.io.FileInputStream;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

public class Dump
{
   public static void main(String[] args) throws Exception
   {
      File input = new File(args[0]);
      Map<String, Object> out = new LinkedHashMap<>();

      try (FileInputStream is = new FileInputStream(input))
      {
         out.put("format", MPPReader.getFileFormat(new POIFSFileSystem(is)));
      }

      ProjectFile file = new MPPReader().read(input);
      s_file = file;
      out.put("project", project(file.getProjectProperties()));

      List<Object> tasks = new ArrayList<>();
      for (Task t : file.getTasks())
      {
         tasks.add(task(t));
      }
      out.put("tasks", tasks);

      List<Object> resources = new ArrayList<>();
      for (Resource r : file.getResources())
      {
         resources.add(resource(r));
      }
      out.put("resources", resources);

      List<Object> assignments = new ArrayList<>();
      for (ResourceAssignment a : file.getResourceAssignments())
      {
         assignments.add(assignment(a));
      }
      out.put("assignments", assignments);

      Map<String, Object> names = new LinkedHashMap<>();
      names.put("task", customFieldNames(file, TaskField::valueOf, FieldTypeClass.TASK));
      names.put("resource", customFieldNames(file, ResourceField::valueOf, FieldTypeClass.RESOURCE));
      names.put("assignment", customFieldNames(file, AssignmentField::valueOf, FieldTypeClass.ASSIGNMENT));
      out.put("customFieldNames", names);

      Map<String, Object> types = new LinkedHashMap<>();
      types.put("task", enterpriseFieldTypes(file, FieldTypeClass.TASK));
      types.put("resource", enterpriseFieldTypes(file, FieldTypeClass.RESOURCE));
      types.put("assignment", enterpriseFieldTypes(file, FieldTypeClass.ASSIGNMENT));
      out.put("enterpriseFieldTypes", types);

      new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT).writeValue(new File(args[1]), out);
   }

   private static Map<String, Object> project(ProjectProperties p)
   {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("title", p.getProjectTitle());
      m.put("subject", p.getSubject());
      m.put("author", p.getAuthor());
      m.put("company", p.getCompany());
      m.put("manager", p.getManager());
      m.put("start", date(p.getStartDate()));
      m.put("finish", date(p.getFinishDate()));
      m.put("statusDate", date(p.getStatusDate()));
      return m;
   }

   private static Map<String, Object> task(Task t)
   {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("uid", t.getUniqueID());
      m.put("id", t.getID());
      m.put("name", t.getName());
      m.put("outlineLevel", t.getOutlineLevel());
      m.put("outlineNumber", t.getOutlineNumber());
      m.put("wbs", t.getWBS());
      m.put("duration", duration(t.getDuration()));
      m.put("start", date(t.getStart()));
      m.put("finish", date(t.getFinish()));
      m.put("percentComplete", number(t.getPercentageComplete()));
      m.put("work", duration(t.getWork()));
      m.put("remainingWork", duration(t.getRemainingWork()));
      m.put("summary", t.getSummary());
      m.put("milestone", t.getMilestone());
      m.put("null", t.getNull());

      List<Object> predecessors = new ArrayList<>();
      for (Relation r : t.getPredecessors())
      {
         Map<String, Object> rel = new LinkedHashMap<>();
         rel.put("uid", r.getPredecessorTask().getUniqueID());
         rel.put("type", r.getType() == null ? null : r.getType().name());
         rel.put("lag", duration(r.getLag()));
         predecessors.add(rel);
      }
      m.put("predecessors", predecessors);
      m.put("customFields", customFields(t, TaskField::valueOf));
      m.put("enterpriseFields", enterpriseFields(t, TaskField::valueOf, FieldTypeClass.TASK));
      return m;
   }

   private static Map<String, Object> resource(Resource r)
   {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("uid", r.getUniqueID());
      m.put("id", r.getID());
      m.put("name", r.getName());
      m.put("type", r.getType() == null ? null : r.getType().name());
      m.put("initials", r.getInitials());
      m.put("group", r.getGroup());
      m.put("maxUnits", number(r.getMaxUnits()));
      Rate rate = r.getStandardRate();
      if (rate == null)
      {
         m.put("standardRate", null);
      }
      else
      {
         Map<String, Object> rm = new LinkedHashMap<>();
         rm.put("amount", rate.getAmount());
         rm.put("units", rate.getUnits() == null ? null : rate.getUnits().name());
         m.put("standardRate", rm);
      }
      m.put("customFields", customFields(r, ResourceField::valueOf));
      m.put("enterpriseFields", enterpriseFields(r, ResourceField::valueOf, FieldTypeClass.RESOURCE));
      return m;
   }

   private static Map<String, Object> assignment(ResourceAssignment a)
   {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("uid", a.getUniqueID());
      m.put("taskUid", a.getTaskUniqueID());
      m.put("resourceUid", a.getResourceUniqueID());
      m.put("units", number(a.getUnits()));
      m.put("work", duration(a.getWork()));
      m.put("start", date(a.getStart()));
      m.put("finish", date(a.getFinish()));
      m.put("customFields", customFields(a, AssignmentField::valueOf));
      m.put("enterpriseFields", enterpriseFields(a, AssignmentField::valueOf, FieldTypeClass.ASSIGNMENT));
      return m;
   }

   // Local custom fields, same order as FieldTables.java.
   private static final List<String> CUSTOM_FIELDS = new ArrayList<>();
   static
   {
      Map<String, Integer> counts = new LinkedHashMap<>();
      counts.put("TEXT", 30);
      counts.put("NUMBER", 20);
      counts.put("COST", 10);
      counts.put("DATE", 10);
      counts.put("START", 10);
      counts.put("FINISH", 10);
      counts.put("DURATION", 10);
      counts.put("FLAG", 20);
      counts.forEach((prefix, count) -> {
         for (int i = 1; i <= count; i++)
         {
            CUSTOM_FIELDS.add(prefix + i);
         }
      });
   }

   // Fixed-name enterprise fields, same order as FieldTables.java.
   private static final List<String> ENTERPRISE_FIELDS = new ArrayList<>();
   static
   {
      Map<String, Integer> counts = new LinkedHashMap<>();
      counts.put("TEXT", 40);
      counts.put("NUMBER", 40);
      counts.put("COST", 10);
      counts.put("DATE", 30);
      counts.put("DURATION", 10);
      counts.put("FLAG", 20);
      counts.forEach((prefix, count) -> {
         for (int i = 1; i <= count; i++)
         {
            ENTERPRISE_FIELDS.add("ENTERPRISE_" + prefix + i);
         }
      });
   }

   private static ProjectFile s_file;

   // Org-defined enterprise fields of a class, by index.
   private static List<UserDefinedField> userDefinedFields(FieldTypeClass cls)
   {
      List<UserDefinedField> list = new ArrayList<>();
      for (UserDefinedField f : s_file.getUserDefinedFields())
      {
         if (f.getFieldTypeClass() == cls)
         {
            list.add(f);
         }
      }
      list.sort((a, b) -> Integer.compare(index(a), index(b)));
      return list;
   }

   private static int index(UserDefinedField f)
   {
      return Integer.parseInt(f.name().substring("ENTERPRISE_CUSTOM_FIELD".length()));
   }

   // Fixed-name enterprise fields that exist for the class first, then org-defined ones.
   private static List<Object> enterpriseFields(FieldContainer c, Function<String, FieldType> field, FieldTypeClass cls)
   {
      List<FieldType> types = new ArrayList<>();
      for (String name : ENTERPRISE_FIELDS)
      {
         try
         {
            types.add(field.apply(name));
         }
         catch (IllegalArgumentException e)
         {
            // no such field for this class
         }
      }
      types.addAll(userDefinedFields(cls));
      return populated(c, types);
   }

   private static Map<String, Object> enterpriseFieldTypes(ProjectFile file, FieldTypeClass cls)
   {
      Map<String, Object> m = new LinkedHashMap<>();
      for (UserDefinedField f : userDefinedFields(cls))
      {
         m.put(f.name(), f.getDataType() == null ? null : f.getDataType().name());
      }
      return m;
   }

   // Only fields with a non-default value (empty, zero, false), like PopulatedFields.
   private static List<Object> customFields(FieldContainer c, Function<String, FieldType> field)
   {
      List<FieldType> types = new ArrayList<>();
      for (String name : CUSTOM_FIELDS)
      {
         types.add(field.apply(name));
      }
      return populated(c, types);
   }

   private static List<Object> populated(FieldContainer c, List<FieldType> fields)
   {
      List<Object> list = new ArrayList<>();
      for (FieldType type : fields)
      {
         String name = type.name();
         Object value = c.get(type);
         Object json;
         if (value instanceof Duration)
         {
            json = ((Duration) value).getDuration() == 0 ? null : duration((Duration) value);
         }
         else if (value instanceof Number)
         {
            json = ((Number) value).doubleValue() == 0 ? null : Double.valueOf(((Number) value).doubleValue());
         }
         else if (value instanceof Boolean)
         {
            json = ((Boolean) value).booleanValue() ? Boolean.TRUE : null;
         }
         else if (value instanceof LocalDateTime)
         {
            json = date((LocalDateTime) value);
         }
         else
         {
            json = value == null || value.toString().isEmpty() ? null : value.toString();
         }
         if (json != null)
         {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("field", name);
            m.put("value", json);
            list.add(m);
         }
      }
      return list;
   }

   private static Map<String, Object> customFieldNames(ProjectFile file, Function<String, FieldType> field, FieldTypeClass cls)
   {
      List<FieldType> types = new ArrayList<>();
      for (String name : CUSTOM_FIELDS)
      {
         types.add(field.apply(name));
      }
      for (String name : ENTERPRISE_FIELDS)
      {
         try
         {
            types.add(field.apply(name));
         }
         catch (IllegalArgumentException e)
         {
            // no such field for this class
         }
      }
      types.addAll(userDefinedFields(cls));
      Map<String, Object> m = new LinkedHashMap<>();
      for (FieldType type : types)
      {
         CustomField cf = file.getCustomFields().get(type);
         if (cf != null && cf.getAlias() != null && !cf.getAlias().isEmpty())
         {
            m.put(type.name(), cf.getAlias());
         }
      }
      return m;
   }

   private static Map<String, Object> duration(Duration d)
   {
      if (d == null)
      {
         return null;
      }
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("value", d.getDuration());
      m.put("units", d.getUnits().name());
      return m;
   }

   private static String date(LocalDateTime d)
   {
      return d == null ? null : d.toString();
   }

   private static Double number(Number n)
   {
      return n == null ? null : n.doubleValue();
   }
}

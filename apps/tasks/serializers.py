from apps.bluebottle_drf2.serializers import MemberPreviewSerializer, SlugGenericRelatedField, PrimaryKeyGenericRelatedField, HyperlinkedFileField, FileSizeField
from apps.bluebottle_utils.serializers import TagSerializer
from apps.projects.models import Project
from apps.projects.serializers import ProjectPreviewSerializer
from apps.tasks.models import Task, TaskMember, TaskFile
from apps.wallposts.models import TextWallPost, MediaWallPost
from apps.wallposts.serializers import MediaWallPostSerializer, TextWallPostSerializer
from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers


class TaskPreviewSerializer(serializers.ModelSerializer):
    author = MemberPreviewSerializer()

    class Meta:
        model = Task
        fields = ('id', 'title', 'location', 'expertise', 'status', 'created')


class TaskMemberSerializer(serializers.ModelSerializer):
    member = MemberPreviewSerializer()
    task = serializers.PrimaryKeyRelatedField()
    status = serializers.ChoiceField(choices=TaskMember.TaskMemberStatuses.choices, required=False, default=TaskMember.TaskMemberStatuses.applied)

    class Meta:
        model = TaskMember
        fields = ('id', 'member', 'task', 'status', 'created')


class TaskFileSerializer(serializers.ModelSerializer):
    author = MemberPreviewSerializer()
    task = serializers.PrimaryKeyRelatedField()
    file = HyperlinkedFileField()
    file_size = FileSizeField(source='file', read_only=True)

    class Meta:
        model = TaskFile
        fields = ('id', 'author', 'task', 'file', 'file_size', 'created', 'title')


class TaskSerializer(serializers.ModelSerializer):
    members = TaskMemberSerializer(many=True, source='taskmember_set')
    files = TaskFileSerializer(many=True, source='taskfile_set')
    project = serializers.SlugRelatedField(slug_field='slug')
    author = MemberPreviewSerializer()
    #tags = serializers.RelatedField(many=True)
    tags = TagSerializer(many=True)

    class Meta:
        model = Task
        fields = ('id', 'title', 'project', 'description', 'end_goal', 'members', 'files', 'location', 'expertise',
                  'time_needed', 'author', 'status', 'created', 'deadline', 'tags')


# Task WallPost serializers

class TaskWallPostSerializer(TextWallPostSerializer):
    """ TextWallPostSerializer with task specific customizations. """

    url = serializers.HyperlinkedIdentityField(view_name='task-twallpost-detail')
    task = PrimaryKeyGenericRelatedField(to_model=Task)

    class Meta(TextWallPostSerializer.Meta):
        # Add the project slug field.
        fields = TextWallPostSerializer.Meta.fields + ('task', )

    def save(self):
        # Save the project content type on save.
        task_type = ContentType.objects.get_for_model(Task)
        self.object.content_type_id = task_type.id
        return super(TaskWallPostSerializer, self).save()

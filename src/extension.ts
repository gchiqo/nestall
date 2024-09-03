import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "nestall" is now active!');

  const disposable = vscode.commands.registerCommand('nestall.generateNestFiles', async (uri: vscode.Uri) => {
    const filePath = uri.fsPath;
    const fileName = path.basename(filePath);

    if (fileName.endsWith('entity.ts')) {
      const entityName = fileName.replace('.entity.ts', '');
      const entityContent = await vscode.workspace.fs.readFile(uri);
      const entityCode = entityContent.toString();

      // Define the directory structure and file contents
      const baseDir = path.join(path.dirname(filePath), '..', entityName);
      const dtoDir = path.join(baseDir, 'dto');

      const files = [
        {
          path: path.join(dtoDir, `Create${entityName}.dto.ts`),
          content: generateCreateDto(entityName, entityCode)
        },
        {
          path: path.join(dtoDir, `Update${entityName}.dto.ts`),
          content: getUpdateDtoContent(entityName)
        },
        {
          path: path.join(baseDir, `${entityName}.controller.ts`),
          content: getControllerContent(entityName, entityCode)
        },
        {
          path: path.join(baseDir, `${entityName}.module.ts`),
          content: getModuleContent(entityName, entityCode)
        },
        {
          path: path.join(baseDir, `${entityName}.service.ts`),
          content: getServiceContent(entityName, entityCode)
        }
      ];

      // Create directories and write files
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);
      if (!fs.existsSync(dtoDir)) fs.mkdirSync(dtoDir);

      files.forEach(file => {
        fs.writeFileSync(file.path, file.content, { encoding: 'utf8' });
      });

      vscode.window.showInformationMessage(`Generated Nest files for ${entityName}`);
    } else {
      vscode.window.showErrorMessage('The selected file is not an entity file.');
    }
  });

  context.subscriptions.push(disposable);
}


function generateCreateDto(entityName: string, entityCode: string): string {
  const lines = entityCode.split('\n');
  let properties = [];
  let imports = new Set(['IsNotEmpty', 'MaxLength', 'IsOptional', 'IsString', 'IsNumber', 'IsEnum']);
  let enums = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('@Column')) {
      const nextLine = lines[i + 1].trim();
      const propertyMatch = nextLine.match(/(\w+):/);
      if (propertyMatch) {
        const propertyName = propertyMatch[1];
        let propertyType = nextLine.split(':')[1].trim().replace(';', '');

        let decorators = ['@IsNotEmpty()'];

        if (line.includes('enum:')) {
          const enumMatch = line.match(/enum: \[(.*?)\]/);
          if (enumMatch) {
            const enumName = `${propertyName}Enum`;
            const enumValues = enumMatch[1]
              .split(',')
              .map(v => v.trim().replace(/"/g, ''))
              .map(v => `${v} = "${v}"`);

            enums.push(`enum ${enumName} {\n  ${enumValues.join(',\n  ')}\n}`);
            decorators.push(`@IsEnum(${enumName})`);
            propertyType = enumName;
          }
        }


        if (line.includes('nullable: true')) {
          decorators = ['@IsOptional()'];
        }

        if (line.includes('length:')) {
          const lengthMatch = line.match(/length: (\d+)/);
          if (lengthMatch) {
            decorators.push(`@MaxLength(${lengthMatch[1]})`);
          }
        }

        if (propertyType.includes('string')) {
          // decorators.push('@IsString()');
        } else if (propertyType.includes('number') || propertyType === 'float' || propertyType === 'decimal') {
          // decorators.push('@IsNumber()');
          propertyType = 'number';
        }

        if (line.includes('unique: true')) {
          decorators.push(`@EntityUnique([${entityName}Entity, '${propertyName}', 'id'])`);
        }

        // Skip certain auto-generated fields
        if (!['id', 'created_at', 'updated_at'].includes(propertyName)) {
          properties.push(`${decorators.join('\n  ')}\n  ${propertyName}: ${propertyType};`);
        }
      }
    }
  }

  const importStatements = `import { ${Array.from(imports).join(', ')} } from 'class-validator';\n` +
    `import { EntityUnique } from 'src/custom/validator/EntityUniqueValidator';\n` +
    `import { ${entityName}Entity } from 'src/typeorm/${entityName}.entity';`;

  return `
${importStatements}

${enums.join('\n\n')}

export class Create${entityName}Dto {
  ${properties.join('\n\n  ')}
}
`;
}

function getUpdateDtoContent(entityName: string): string {
  return `
import { PartialType } from '@nestjs/mapped-types';
import { Create${entityName}Dto } from './Create${entityName}.dto';
import { IsNotEmpty } from 'class-validator';

export class Update${entityName}Dto extends PartialType(Create${entityName}Dto) {
    @IsNotEmpty()
    id: number;
}
    `;
}

function getControllerContent(entityName: string, entityCode: string): string {
  const hasImage = entityCode.includes('img');

  return `
import { Body, Controller, Delete, Get, Param, Post, Put, Query${hasImage ? ', UploadedFile, UseInterceptors' : ''} } from '@nestjs/common';
import { ${entityName}Service } from './${entityName}.service';${hasImage ? `\nimport { FileInterceptor } from '@nestjs/platform-express';` : ''}
import { Create${entityName}Dto } from './dto/Create${entityName}.dto';
import { Update${entityName}Dto } from './dto/Update${entityName}.dto';

@Controller('${entityName.toLowerCase()}')
export class ${entityName}Controller {
  constructor(private readonly ${entityName.toLowerCase()}Service: ${entityName}Service) {}

  @Post()${hasImage ? `\n  @UseInterceptors(FileInterceptor('image'))` : ''}
  async create(
    @Body() create${entityName}Dto: Create${entityName}Dto,${hasImage ? `\n    @UploadedFile() image: { buffer: Buffer; originalname: string },` : ''}
  ) {
    return await this.${entityName.toLowerCase()}Service.create(create${entityName}Dto${hasImage ? ', image' : ''});
  }

  @Put(':id')${hasImage ? `\n  @UseInterceptors(FileInterceptor('image'))` : ''}
  async update(
    @Param('id') id: number,
    @Body() update${entityName}Dto: Update${entityName}Dto,${hasImage ? `\n    @UploadedFile() image: { buffer: Buffer; originalname: string },` : ''}
  ) {
    return await this.${entityName.toLowerCase()}Service.update(id, update${entityName}Dto${hasImage ? ', image' : ''});
  }

  @Get()
  async getAll(@Query() query: any) {
    return await this.${entityName.toLowerCase()}Service.getAll(query);
  }

  @Get(':id')
  async getById(@Param('id') id: number, @Query('relation') relation?: boolean) {
    return await this.${entityName.toLowerCase()}Service.getOne(id, relation);
  }

  @Delete(':id')
  async delete(@Param('id') id: number) {
    return await this.${entityName.toLowerCase()}Service.delete(id);
  }
}
  `;
}


function getModuleContent(entityName: string, entityCode: string): string {
  const hasImage = entityCode.includes('img');

  return `
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ${entityName}Controller } from './${entityName}.controller';
import { ${entityName}Service } from './${entityName}.service';${hasImage ? `\nimport { ImageService } from 'src/custom/Image.service';` : ''}
import { ${entityName}Entity } from 'src/typeorm/${entityName}.entity';

@Module({
  imports: [TypeOrmModule.forFeature([${entityName}Entity])],
  controllers: [${entityName}Controller],
  providers: [${entityName}Service${hasImage ? ', ImageService' : ''}],
})
export class ${entityName}Module {}
  `;
}


function getServiceContent(entityName: string, entityCode: string): string {
  const hasImage = entityCode.includes('img');
  const entityVariableName = `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}`;

  return `
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Update${entityName}Dto } from './dto/Update${entityName}.dto';${hasImage ? `\nimport { ImageService } from 'src/custom/Image.service';` : ''}
import { ${entityName}Entity } from 'src/typeorm/${entityName}.entity';
import { Create${entityName}Dto } from './dto/Create${entityName}.dto';
${hasImage ? `
type ImageFile = {
  buffer: Buffer;
  originalname: string;
};
` : ''}
@Injectable()
export class ${entityName}Service {
  constructor(
    @InjectRepository(${entityName}Entity)
    private ${entityVariableName}Repository: Repository<${entityName}Entity>,${hasImage ? `\n    private readonly imageService: ImageService,` : ''}
  ) { }

  async create(${entityVariableName}Dto: Create${entityName}Dto${hasImage ? `, image?: ImageFile` : ''}): Promise<${entityName}Entity> {
    ${hasImage ? `
    if (image) {
      const imgPath = await this.imageService.saveImage(image, '${entityVariableName}');
      ${entityVariableName}Dto.img = imgPath;
    }
    ` : ''}
    const new${entityName} = this.${entityVariableName}Repository.create(${entityVariableName}Dto);
    const created${entityName} = await this.${entityVariableName}Repository.save(new${entityName});

    return this.getOne(created${entityName}.id);
  }

  async update(id: number, ${entityVariableName}Dto: Update${entityName}Dto${hasImage ? `, image?: ImageFile` : ''}): Promise<${entityName}Entity> {
    const existing${entityName} = await this.getOne(id);
    ${hasImage ? `
    if (image) {
      if (existing${entityName}.img) {
        await this.imageService.deleteImage(existing${entityName}.img);
      }
      ${entityVariableName}Dto.img = await this.imageService.saveImage(image, '${entityVariableName}');
    }
    ` : ''}
    await this.${entityVariableName}Repository.update(id, ${entityVariableName}Dto);

    return this.getOne(id);
  }

  async getOne(id: number, relation?: boolean): Promise<${entityName}Entity> {
    const relations = relation ? [] : []

    const ${entityVariableName} = await this.${entityVariableName}Repository.findOne({ where: { id }, relations: relations });
    if (!${entityVariableName}) throw new NotFoundException(\`${entityName} with ID \${id} not found\`);
    return ${entityVariableName};
  }

  async getAll(query: any) {
    return this.${entityVariableName}Repository.find({
      where: {
        // type: query.type ? query.type : undefined,
      },
      relations: [],
      take: query.per_page ? query.per_page : 30,
      skip: query.per_page ? (query.page - 1) * query.per_page : 0
    });
  }

  async delete(id: number): Promise<void> {
    const existing${entityName} = await this.getOne(id);
    ${hasImage ? `
    if (existing${entityName}.img) {
      await this.imageService.deleteImage(existing${entityName}.img);
    }
    ` : ''}
    await this.${entityVariableName}Repository.delete(id);
  }
}
  `;
}




export function deactivate() { }
